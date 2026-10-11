package com.streamulus.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** An error returned by the Streamulus server ({ "error": "...", "code": "..." }). */
class ApiException(val status: Int, override val message: String, val code: String? = null) : Exception(message) {
    /** The server wants (or didn't accept) a new account's Admin Passphrase. */
    val isPassphraseError: Boolean get() = code?.startsWith("PASSPHRASE_") == true
}

/** Shared HTTP clients. Subtitles can take minutes the first time, so they get their own. */
object Http {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    val long: OkHttpClient = client.newBuilder()
        .readTimeout(600, TimeUnit.SECONDS)
        .build()

    val json = Json { ignoreUnknownKeys = true; isLenient = true }
}

private val JSON = "application/json; charset=utf-8".toMediaType()

/** Runs an OkHttp call without blocking, and cancels it with the coroutine. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (continuation.isActive) continuation.resume(response) else response.close()
        }
    })
}

/** Thin JSON client for the Streamulus REST API. */
class ApiClient(val baseUrl: HttpUrl, @Volatile var token: String? = null) {

    /** Absolute URL for a server path such as "/api/movies" (each part is encoded). */
    fun url(path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val builder = baseUrl.newBuilder()
        path.trim('/').split('/').filter { it.isNotEmpty() }.forEach { builder.addPathSegment(it) }
        query.forEach { (key, value) -> builder.addQueryParameter(key, value) }
        return builder.build()
    }

    suspend fun get(path: String, query: Map<String, String> = emptyMap()): JsonElement = send("GET", path, query, null)

    suspend fun post(path: String, body: JsonObject = JsonObject(emptyMap())): JsonElement = send("POST", path, emptyMap(), body)

    suspend fun put(path: String, body: JsonObject = JsonObject(emptyMap())): JsonElement = send("PUT", path, emptyMap(), body)

    suspend fun delete(path: String): JsonElement = send("DELETE", path, emptyMap(), null)

    /** A JSON object response (the usual case). */
    suspend fun getObject(path: String, query: Map<String, String> = emptyMap()): JsonObject =
        get(path, query) as? JsonObject ?: throw ApiException(0, "The server sent something unexpected.")

    /** A text response plus its headers (WebVTT subtitles and X-Subtitles-Complete). */
    suspend fun getText(path: String): Pair<String, Map<String, String>> {
        val request = request("GET", url(path), null)
        val response = Http.long.newCall(request).await()
        return withContext(Dispatchers.IO) {
            response.use {
                val text = it.body?.string() ?: ""
                if (!it.isSuccessful) throw error(it.code, text)
                text to it.headers.toMultimap().mapValues { (_, values) -> values.firstOrNull() ?: "" }.mapKeys { (key, _) -> key.lowercase() }
            }
        }
    }

    private suspend fun send(method: String, path: String, query: Map<String, String>, body: JsonObject?): JsonElement {
        val response = Http.client.newCall(request(method, url(path, query), body)).await()
        return withContext(Dispatchers.IO) {
            response.use {
                val text = it.body?.string() ?: ""
                if (!it.isSuccessful) throw error(it.code, text)
                if (text.isBlank()) JsonObject(emptyMap()) else Http.json.parseToJsonElement(text)
            }
        }
    }

    private fun request(method: String, url: HttpUrl, body: JsonObject?): Request {
        val requestBody = when {
            body != null -> body.toString().toRequestBody(JSON)
            method == "GET" || method == "DELETE" -> null
            else -> "{}".toRequestBody(JSON)
        }
        val builder = Request.Builder().url(url).method(method, requestBody).header("Accept", "application/json")
        token?.let { builder.header("Authorization", "Bearer $it") }
        return builder.build()
    }

    private fun error(status: Int, text: String): ApiException {
        val json = runCatching { Http.json.parseToJsonElement(text) as? JsonObject }.getOrNull()
        val message = (json?.get("error") as? JsonPrimitive)?.content ?: "The server returned an error ($status)."
        return ApiException(status, message, (json?.get("code") as? JsonPrimitive)?.content)
    }

    companion object {
        /** Does a Streamulus server answer at `url` within `timeoutMs`? */
        suspend fun ping(url: HttpUrl, timeoutMs: Long): Boolean = runCatching {
            val client = Http.client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()
            val health = ApiClient(url).url("/api/health")
            client.newCall(Request.Builder().url(health).build()).await().use { it.code == 200 }
        }.getOrDefault(false)
    }
}
