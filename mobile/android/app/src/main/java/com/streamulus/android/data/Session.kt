package com.streamulus.android.data

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.streamulus.android.R
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/**
 * Which screen the app shows, the signed-in account and profile, and every call
 * to the server. Mirrors the iPhone app's Session: it connects to the home
 * address, learns the server's public address (Admin › Settings › Remote Access)
 * and switches between the two by itself when one stops answering.
 */
class Session(private val app: Application) {

    sealed interface Phase {
        data object Starting : Phase
        data object NeedsServer : Phase
        data object SignedOut : Phase
        data object PickingProfile : Phase
        data object Ready : Phase
        data class Unreachable(val message: String) : Phase
    }

    var phase by mutableStateOf<Phase>(Phase.Starting)
        private set
    var user by mutableStateOf<User?>(null)
        private set
    var profile by mutableStateOf<Profile?>(null)
        private set

    /** The address in use right now: the home one, or the public one when away. */
    var serverUrl by mutableStateOf<HttpUrl?>(null)
        private set
    /** The address entered when setting up (usually on the home network). */
    var homeUrl by mutableStateOf<HttpUrl?>(null)
        private set
    /** The server's public address, learned from the server; used when home doesn't answer. */
    var publicUrl by mutableStateOf<HttpUrl?>(null)
        private set
    /** Logo / text settings from Admin › Settings › Branding. */
    var branding by mutableStateOf(Branding.Default)
        private set

    /** Goes up each time the player closes, so screens reload Continue Watching and progress. */
    var playbackGeneration by mutableIntStateOf(0)
        private set

    val usingPublicAddress: Boolean get() = serverUrl != null && serverUrl == publicUrl && serverUrl != homeUrl

    private val prefs = app.getSharedPreferences("streamulus", Context.MODE_PRIVATE)
    private val tokens = TokenStore(app)
    private var api: ApiClient? = null

    /** Lists kept while the app runs, so going back to a screen shows it straight away. */
    val memory = HashMap<String, Any>()

    init {
        val saved = prefs.getString(SERVER, null)?.toHttpUrlOrNull()
        if (saved != null) {
            homeUrl = saved
            serverUrl = saved
            api = ApiClient(saved, tokens.token, clientName)
        } else {
            presetServer?.let { homeUrl = it }
        }
        publicUrl = prefs.getString(PUBLIC, null)?.toHttpUrlOrNull()
    }

    /** Optional server address built into the app (res/values/config.xml). */
    private val presetServer: HttpUrl?
        get() = app.getString(R.string.streamulus_server_url).trim().takeIf { it.isNotEmpty() }?.let { normalize(it) }

    // ── Start-up ─────────────────────────────────────────────────────────────

    /** Whether start() has run in this app process (the screen may be rebuilt; the session isn't). */
    var started = false
        private set

    suspend fun start() {
        started = true
        if (homeUrl == null) {
            phase = Phase.NeedsServer
            return
        }
        phase = Phase.Starting
        // Whichever answers: the home address first, then the public one.
        if (!connectToReachableAddress()) {
            phase = Phase.Unreachable(
                if (publicUrl == null) "The server isn't answering at ${homeUrl?.host ?: "its address"}."
                else "The server isn't answering at home (${homeUrl?.host}) or at ${publicUrl?.host}.",
            )
            return
        }
        if (prefs.getString(SERVER, null) == null) homeUrl?.let { prefs.edit().putString(SERVER, it.toString()).apply() }
        refreshBranding()
        val client = api
        if (client?.token == null) {
            phase = Phase.SignedOut
            return
        }
        try {
            val me = client.getObject("/api/auth/me")
            user = me.obj("user")?.let(User::from)
            profile = me.obj("profile")?.let(Profile::from)
            phase = Phase.Ready
        } catch (e: ApiException) {
            if (e.status == 401) signOut() else phase = Phase.Unreachable(e.message)
        } catch (e: IOException) {
            phase = Phase.Unreachable(e.localizedMessage ?: "The server isn't answering.")
        }
    }

    // ── Server ───────────────────────────────────────────────────────────────

    /** Accepts "192.168.1.20:8096", "http://nas.local:8096/", "https://name.tailnet.ts.net", etc. */
    suspend fun setServer(text: String) {
        val url = normalize(text) ?: throw ApiException(0, "That doesn't look like a server address.")
        val client = ApiClient(url, clientName = clientName)
        client.getObject("/api/health")
        prefs.edit().putString(SERVER, url.toString()).remove(PUBLIC).apply()
        tokens.token = null
        homeUrl = url
        publicUrl = null
        serverUrl = url
        api = client
        refreshBranding()
        phase = Phase.SignedOut
    }

    fun changeServer() {
        signOut()
        prefs.edit().remove(SERVER).remove(PUBLIC).apply()
        homeUrl = null
        publicUrl = null
        serverUrl = null
        api = null
        branding = Branding.Default
        phase = Phase.NeedsServer
    }

    private fun normalize(text: String): HttpUrl? {
        var address = text.trim()
        if (!address.contains("://")) address = "http://$address"
        return address.trimEnd('/').toHttpUrlOrNull()
    }

    /** Use the home address if it answers quickly, otherwise the public one. */
    private suspend fun connectToReachableAddress(): Boolean {
        homeUrl?.let { home -> if (ApiClient.ping(home, 4000)) { use(home); return true } }
        publicUrl?.let { pub -> if (pub != homeUrl && ApiClient.ping(pub, 10000)) { use(pub); return true } }
        return false
    }

    private fun use(url: HttpUrl) {
        if (serverUrl == url && api != null) return
        serverUrl = url
        api = ApiClient(url, tokens.token, clientName)
    }

    /** The current address stopped answering (left home, or came back): try the other one. */
    private suspend fun switchAddress(): Boolean {
        val other = (if (serverUrl == publicUrl) homeUrl else publicUrl) ?: return false
        if (other == serverUrl || !ApiClient.ping(other, 6000)) return false
        use(other)
        return true
    }

    /** Branding and the public address (public endpoint, no sign-in needed). */
    suspend fun refreshBranding() {
        val client = api ?: return
        val fetched = runCatching { Branding.from(client.getObject("/api/branding")) }.getOrNull() ?: return
        branding = fetched
        val url = fetched.publicUrl?.toHttpUrlOrNull()
        publicUrl = url
        prefs.edit().apply { if (url != null) putString(PUBLIC, url.toString()) else remove(PUBLIC) }.apply()
    }

    // ── Sign in / out ────────────────────────────────────────────────────────

    /** `passphrase`: the single-use Admin Passphrase, only for a new account's first sign-in. */
    suspend fun login(username: String, password: String, passphrase: String? = null) {
        val body = buildJsonObject {
            put("username", username)
            put("password", password)
            if (!passphrase.isNullOrBlank()) put("passphrase", passphrase)
        }
        val response = client().post("/api/auth/login", body) as JsonObject
        completeSignIn(signInFrom(response) ?: throw ApiException(0, "The server sent something unexpected."))
    }

    /** Create an account (display name, password, email for password resets). It waits for an Admin Passphrase. Returns (name, message). */
    suspend fun register(displayName: String, password: String, email: String): Pair<String, String> {
        val response = client().post("/api/auth/register", buildJsonObject {
            put("displayName", displayName)
            put("password", password)
            put("email", email)
        }) as JsonObject
        return (response.str("username") ?: displayName) to (response.str("message") ?: "")
    }

    /** A page of the Streamulus website at the address in use, e.g. "/forgot-password". */
    fun websiteUrl(path: String): String? = api?.url(path)?.toString()

    fun completeSignIn(signIn: SignIn) {
        tokens.token = signIn.token
        api?.token = signIn.token
        user = signIn.user
        profile = signIn.profile
        memory.clear()
        phase = if (signIn.profileCount > 1) Phase.PickingProfile else Phase.Ready
    }

    fun signOut() {
        // End this device's sign-in on the server too (not waited for).
        api?.takeIf { it.token != null }?.let { client ->
            MainScope().launch { runCatching { client.post("/api/auth/logout") } }
        }
        tokens.token = null
        api?.token = null
        user = null
        profile = null
        memory.clear()
        phase = if (api == null) Phase.NeedsServer else Phase.SignedOut
    }

    // ── Quick Login ──────────────────────────────────────────────────────────

    suspend fun quickLoginStart(): QuickStart =
        QuickStart.from(client().post("/api/auth/quick/start", buildJsonObject { put("deviceName", Build.MODEL ?: "Android") }) as JsonObject)

    /** Null while waiting; the sign-in once approved. Throws ApiException(410) when the code expires. */
    suspend fun quickLoginPoll(requestId: String): SignIn? {
        val response = client().post("/api/auth/quick/poll", buildJsonObject { put("requestId", requestId) }) as JsonObject
        return if (response.str("status") == "approved") signInFrom(response) else null
    }

    /** Web page the QR code opens, with the code filled in. */
    fun quickLoginLink(code: String): String = api?.url("/quick-login", mapOf("code" to code))?.toString() ?: ""

    private fun signInFrom(o: JsonObject): SignIn? {
        val token = o.str("token") ?: return null
        val user = o.obj("user")?.let(User::from) ?: return null
        val profile = o.obj("profile")?.let(Profile::from) ?: return null
        return SignIn(token, user, profile, o.int("profileCount") ?: 1)
    }

    // ── Profiles ─────────────────────────────────────────────────────────────

    suspend fun profiles(): List<Profile> = getObject("/api/profiles").objects("profiles").map(Profile::from)

    /** Switch profile. `pin` / `password` when the profile list says it needs one. */
    suspend fun selectProfile(target: Profile, pin: String? = null, password: String? = null) {
        val response = post("/api/profiles/${target.id}/select", buildJsonObject {
            pin?.let { put("pin", it) }
            password?.let { put("password", it) }
        })
        val token = response.str("token") ?: return
        tokens.token = token
        api?.token = token
        profile = response.obj("profile")?.let(Profile::from)
        memory.clear()
        phase = Phase.Ready
    }

    fun switchProfile() {
        phase = Phase.PickingProfile
    }

    /** Titles and descriptions in English (this profile, everywhere). */
    suspend fun setEnglishTitles(on: Boolean) {
        val current = profile ?: return
        val response = put("/api/profiles/${current.id}", buildJsonObject { put("english_titles", on) })
        response.obj("profile")?.let { profile = Profile.from(it) }
        memory.clear()
    }

    /** Preferred audio language for files with several audio tracks ("default", "original", "en", "ja"…). */
    suspend fun setAudioLanguage(code: String) {
        val current = profile ?: return
        val response = put("/api/profiles/${current.id}", buildJsonObject { put("audio_language", code) })
        response.obj("profile")?.let { profile = Profile.from(it) }
    }

    /** Turn on English subtitles whenever the audio is in another language. */
    suspend fun setAutoSubtitles(on: Boolean) {
        val current = profile ?: return
        val response = put("/api/profiles/${current.id}", buildJsonObject { put("auto_subtitles", on) })
        response.obj("profile")?.let { profile = Profile.from(it) }
    }

    /** The admin's provided pictures this profile may pick, and which it uses now. */
    suspend fun avatarChoices(): Pair<List<AvatarCategory>, Int?> {
        val current = profile ?: return emptyList<AvatarCategory>() to null
        val response = getObject("/api/profiles/${current.id}/avatar/library")
        return response.objects("categories").map(AvatarCategory::from) to response.int("currentImageId")
    }

    suspend fun chooseAvatar(imageId: Int) {
        val current = profile ?: return
        val response = put("/api/profiles/${current.id}/avatar/library", buildJsonObject { put("imageId", imageId) })
        response.obj("profile")?.let { profile = Profile.from(it) }
    }

    // ── Feedback ─────────────────────────────────────────────────────────────

    suspend fun feedback(): List<FeedbackItem> = getObject("/api/feedback").objects("items").map(FeedbackItem::from)

    suspend fun unreadFeedbackCount(): Int = runCatching { getObject("/api/feedback/unread").int("count") ?: 0 }.getOrDefault(0)

    suspend fun sendFeedback(kind: String, message: String): FeedbackItem? =
        post("/api/feedback", buildJsonObject {
            put("kind", kind)
            put("message", message)
            put("platform", if (app.resources.configuration.smallestScreenWidthDp >= 600) "android-tablet" else "android")
            put("appVersion", appVersion)
        }).obj("item")?.let(FeedbackItem::from)

    suspend fun replyToFeedback(id: Int, message: String): FeedbackItem? =
        post("/api/feedback/$id/messages", buildJsonObject { put("message", message) }).obj("item")?.let(FeedbackItem::from)

    suspend fun markFeedbackRead(id: Int) {
        runCatching { post("/api/feedback/$id/read") }
    }

    /** "Android 1.0.10 · Pixel 9" — shown to the admin under the account's devices. */
    val clientName: String
        get() = "Android ${appVersion.substringBefore(" (")} · ${Build.MODEL ?: "Android device"}"

    /** e.g. "1.0 (1)". */
    val appVersion: String
        get() = runCatching {
            @Suppress("DEPRECATION")
            val info = app.packageManager.getPackageInfo(app.packageName, 0)
            val build = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
            "${info.versionName} ($build)"
        }.getOrDefault("?")

    fun notePlaybackEnded() {
        playbackGeneration++
    }

    // ── Requests (signed in) ─────────────────────────────────────────────────

    suspend fun getObject(path: String, query: Map<String, String> = emptyMap()): JsonObject =
        signedIn { it.getObject(path, query) }

    suspend fun post(path: String, body: JsonObject = JsonObject(emptyMap())): JsonObject =
        signedIn { it.post(path, body) as? JsonObject ?: JsonObject(emptyMap()) }

    suspend fun put(path: String, body: JsonObject = JsonObject(emptyMap())): JsonObject =
        signedIn { it.put(path, body) as? JsonObject ?: JsonObject(emptyMap()) }

    /** Subtitles: the WebVTT text and whether it's complete (the server may still be reading the file). */
    suspend fun subtitles(path: String): Pair<String, Boolean> = signedIn { client ->
        val (text, headers) = client.getText(path)
        text to (headers["x-subtitles-complete"] != "0")
    }

    /** Runs a request; a 401 (expired token, removed profile) signs out. */
    private suspend fun <T> signedIn(request: suspend (ApiClient) -> T): T {
        try {
            return request(client())
        } catch (e: ApiException) {
            if (e.status == 401) signOut()
            throw e
        } catch (e: IOException) {
            // Left home (or came back): switch between the home and public address and retry once.
            if (!switchAddress()) throw e
            return request(client())
        }
    }

    private fun client(): ApiClient = api ?: throw ApiException(0, "No server set up.")

    // ── URLs ─────────────────────────────────────────────────────────────────

    /** Artwork URL: full URLs as-is, uploads from this server, other paths from TMDB. */
    fun imageUrl(path: String?): String? {
        if (path.isNullOrEmpty()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        // Our own server's files: uploads, and streaming service logos (/api/services/logos/…).
        if (path.startsWith("/uploads/") || path.startsWith("/api/")) return api?.url(path)?.toString()
        if (path.startsWith("/")) return "https://image.tmdb.org/t/p/w780$path"
        return null
    }

    /** A frame from `seconds` into the movie/episode (Continue Watching). */
    fun stillUrl(type: String, id: Int, seconds: Int): String? {
        val client = api ?: return null
        val token = client.token ?: return null
        return client.url("/api/stream/still/$type/$id", mapOf("t" to seconds.toString(), "token" to token)).toString()
    }

    /**
     * HLS stream starting `start` seconds in. `compat` asks the server to re-encode
     * everything; `audio` picks one of the file's audio tracks (null = this profile's choice).
     */
    fun streamUrl(type: MediaType, id: Int, start: Int, compat: Boolean = false, audio: Int? = null): String? {
        val client = api ?: return null
        val token = client.token ?: return null
        val query = buildMap {
            put("token", token)
            if (start > 0) put("start", start.toString())
            if (compat) put("compat", "1")
            if (audio != null) put("audio", audio.toString())
        }
        return client.url("/api/stream/hls/${type.key}/$id/manifest.m3u8", query).toString()
    }

    private companion object {
        const val SERVER = "serverURL"
        const val PUBLIC = "publicServerURL"
    }
}
