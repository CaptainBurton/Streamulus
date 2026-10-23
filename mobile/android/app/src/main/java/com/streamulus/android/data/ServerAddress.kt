package com.streamulus.android.data

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.text.Normalizer

/**
 * Turns whatever someone typed or pasted as a server address into the addresses worth
 * trying, best first. Addresses copied from chats and browsers often carry invisible
 * characters (zero-width spaces, direction marks), stray spaces or quotes, a page path
 * such as /login, a mistyped "https//", or no scheme at all, and a Tailscale Funnel
 * address only answers over https://.
 */
object ServerAddress {
    /** Spaces, control and format characters: never part of a server address. */
    private val invisible = Regex("[\\s\\p{C}\\p{Z}]")
    /** "https://", "https:/", "https//", "https:", "https;//", "http:\\\\" … */
    private val scheme = Regex("^(https?)(?::|;)?[/\\\\]*", RegexOption.IGNORE_CASE)
    private val anyScheme = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)
    private val explicitPort = Regex(":\\d+$")
    private val ipv4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
    private const val WRAPPING = "\"'<>(),;.“”‘’`"

    fun candidates(text: String): List<HttpUrl> {
        var address = Normalizer.normalize(text, Normalizer.Form.NFKC).replace(invisible, "").trim { it in WRAPPING }
        if (address.isEmpty()) return emptyList()

        // Which scheme they typed (if any), and the rest of the address after it.
        var typed: String? = null
        val match = scheme.find(address)
        if (match != null && match.value.length > match.groupValues[1].length) {
            typed = match.groupValues[1].lowercase()
            address = address.substring(match.value.length)
        } else if (anyScheme.containsMatchIn(address)) {
            return emptyList() // ftp://, streamulus:// …
        }

        val hostPart = address.substringBefore('/').substringBefore('?').substringBefore('#').substringAfterLast('@')
        if (hostPart.isEmpty()) return emptyList()
        val hasPort = explicitPort.containsMatchIn(hostPart)
        val host = hostPart.replace(explicitPort, "").trim('[', ']').lowercase()
        val local = hasPort || host.contains(':') || ipv4.matches(host) || !host.contains('.') ||
            host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home")

        val schemes = when (typed) {
            "https" -> listOf("https") // never quietly drop to plain http
            "http" -> if (local) listOf("http") else listOf("http", "https")
            else -> if (local) listOf("http", "https") else listOf("https", "http")
        }
        return schemes.flatMap { s ->
            val url = "$s://$address".toHttpUrlOrNull() ?: return@flatMap emptyList()
            // The server lives at the root; a pasted page path (/login, /movie/12) is dropped,
            // but kept as a last resort in case it sits behind a proxy under a sub-path.
            val root = url.newBuilder().encodedPath("/").query(null).fragment(null).username("").password("").build()
            val withPath = url.newBuilder().query(null).fragment(null).username("").password("").build()
            listOfNotNull(root, withPath.takeIf { url.encodedPath.trimEnd('/').isNotEmpty() })
        }.distinct()
    }
}
