package com.ras.tasks.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatesTest {
    private val hash = "a".repeat(64)

    private fun json(code: Int = 8, url: String = "https://example.com/app.apk", sha: String = hash) =
        """{"versionCode": $code, "versionName": "1.7", "apkUrl": "$url", "sha256": "$sha", "notes": "ignored"}"""

    @Test
    fun parsesAValidVersionFileAndIgnoresUnknownFields() {
        val info = requireNotNull(Updates.parse(json()))
        assertEquals(8, info.versionCode)
        assertEquals("1.7", info.versionName)
        assertEquals("https://example.com/app.apk", info.apkUrl)
    }

    @Test
    fun rejectsBrokenOrUnsafeFiles() {
        assertNull(Updates.parse("not json"))
        assertNull(Updates.parse(json(url = "http://example.com/app.apk")))
        assertNull(Updates.parse(json(sha = "xyz")))
        assertNull(Updates.parse(json(code = 0)))
    }

    @Test
    fun onlyAHigherVersionCodeIsAnUpdate() {
        val info = requireNotNull(Updates.parse(json(code = 8)))
        assertTrue(Updates.isNewer(info, 7))
        assertFalse(Updates.isNewer(info, 8))
        assertFalse(Updates.isNewer(info, 9))
    }

    @Test
    fun checksAAtMostOnceADay() {
        val day = 24L * 60 * 60 * 1000
        val last = 1_000_000L
        assertTrue(Updates.shouldCheck(0, last))
        assertFalse(Updates.shouldCheck(last, last + day - 1))
        assertTrue(Updates.shouldCheck(last, last + day))
        assertTrue(Updates.shouldCheck(last, last - 5))
    }

    @Test
    fun sha256MatchesTheKnownVectorAndIsCaseInsensitive() {
        val abc = Updates.sha256Hex("abc".toByteArray())
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", abc)
        assertTrue(Updates.hashMatches(abc, abc.uppercase()))
        assertFalse(Updates.hashMatches(abc, "0".repeat(64)))
    }
}
