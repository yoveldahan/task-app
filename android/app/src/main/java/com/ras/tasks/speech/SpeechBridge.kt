package com.ras.tasks.speech

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lets the site's voice input (QuickCapture) use Android's speech recognizer.
 * The page shim below provides the same SpeechRecognition API the site already uses; this class does the native part.
 * Messages go over a WebMessage channel that only the site's origin can reach.
 */
class SpeechBridge(
    private val context: Context,
    /** Asks for the microphone permission; the answer comes back to [onPermissionResult]. */
    private val askForMicrophone: () -> Unit,
) {
    private var reply: JavaScriptReplyProxy? = null
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var pendingStart: JSONObject? = null
    private var hasMicrophone = false

    /** Called on the UI thread for every message from the page. */
    fun onMessage(message: String, proxy: JavaScriptReplyProxy) {
        reply = proxy
        val json = runCatching { JSONObject(message) }.getOrNull() ?: return
        when (json.optString("type")) {
            "start" -> start(json)
            "stop" -> recognizer?.stopListening()
            "abort" -> {
                recognizer?.cancel()
                listening = false
                send(JSONObject().put("type", "end"))
            }
        }
    }

    /** Called with the answer to the microphone permission request. */
    fun onPermissionResult(granted: Boolean) {
        hasMicrophone = granted
        val pending = pendingStart ?: return
        pendingStart = null
        if (granted) {
            start(pending)
        } else {
            send(JSONObject().put("type", "error").put("error", "not-allowed"))
            send(JSONObject().put("type", "end"))
        }
    }

    /** Stops the recognizer when the activity goes away. */
    fun release() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    private fun start(json: JSONObject) {
        if (listening) return
        if (!hasMicrophone) {
            pendingStart = json
            askForMicrophone()
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            send(JSONObject().put("type", "error").put("error", "service-not-allowed"))
            send(JSONObject().put("type", "end"))
            return
        }
        val rec = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        listening = true
        rec.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, json.optString("lang", "he-IL"))
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, json.optBoolean("interimResults", false))
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            },
        )
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            send(JSONObject().put("type", "start"))
        }

        override fun onResults(results: Bundle?) {
            sendResult(firstText(results), final = true)
            finish()
        }

        override fun onPartialResults(partialResults: Bundle?) {
            sendResult(firstText(partialResults), final = false)
        }

        override fun onError(error: Int) {
            send(JSONObject().put("type", "error").put("error", browserError(error)))
            finish()
        }

        override fun onBeginningOfSpeech() {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun finish() {
        listening = false
        send(JSONObject().put("type", "end"))
    }

    private fun sendResult(text: String, final: Boolean) {
        if (text.isEmpty() && final) return
        val item = JSONObject().put("transcript", text).put("isFinal", final)
        send(JSONObject().put("type", "result").put("results", JSONArray().put(item)))
    }

    private fun firstText(bundle: Bundle?): String =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

    /** Maps recognizer errors to the names the browser API uses; the site handles these names. */
    private fun browserError(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "network"
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        SpeechRecognizer.ERROR_CLIENT -> "aborted"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "aborted"
        else -> "unknown"
    }

    private fun send(message: JSONObject) {
        reply?.postMessage(message.toString())
    }

    companion object {
        /** Name of the object the page talks to; it is exposed only to the site's origin. */
        const val CHANNEL = "RasSpeech"

        /**
         * Runs before the page's own scripts. Replaces SpeechRecognition with a shim that forwards to [CHANNEL].
         * The site checks for window.SpeechRecognition when it renders, so the shim must exist before that.
         */
        const val SHIM_SCRIPT = """
            (function () {
              if (window.__rasSpeechShim) return;
              window.__rasSpeechShim = true;
              var current = null;

              function send(obj) {
                if (window.$CHANNEL) window.$CHANNEL.postMessage(JSON.stringify(obj));
              }

              function Recognition() {
                this.lang = 'he-IL';
                this.continuous = false;
                this.interimResults = false;
                this.onstart = null;
                this.onresult = null;
                this.onerror = null;
                this.onend = null;
              }
              Recognition.prototype.start = function () {
                current = this;
                send({ type: 'start', lang: this.lang, continuous: !!this.continuous, interimResults: !!this.interimResults });
              };
              Recognition.prototype.stop = function () { send({ type: 'stop' }); };
              Recognition.prototype.abort = function () { send({ type: 'abort' }); };

              function handle(msg) {
                var rec = current;
                if (!rec) return;
                if (msg.type === 'start' && rec.onstart) rec.onstart({});
                if (msg.type === 'result' && rec.onresult) {
                  var results = msg.results.map(function (r) {
                    var item = [{ transcript: r.transcript, confidence: 1 }];
                    item.isFinal = r.isFinal;
                    return item;
                  });
                  rec.onresult({ results: results, resultIndex: 0 });
                }
                if (msg.type === 'error' && rec.onerror) rec.onerror({ error: msg.error });
                if (msg.type === 'end') {
                  current = null;
                  if (rec.onend) rec.onend({});
                }
              }

              function wire() {
                if (window.$CHANNEL) {
                  window.$CHANNEL.onmessage = function (event) { handle(JSON.parse(event.data)); };
                } else {
                  setTimeout(wire, 50);
                }
              }

              window.SpeechRecognition = Recognition;
              if (!window.webkitSpeechRecognition) window.webkitSpeechRecognition = Recognition;
              wire();
            })();
        """
    }
}
