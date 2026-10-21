package com.streamulus.android.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

// Models for the Streamulus API, read leniently: the server (SQLite) can send
// numbers as integers or decimals, booleans as true/false or 0/1, and many
// fields as null.

private fun JsonObject.prim(key: String): JsonPrimitive? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }

fun JsonObject.str(key: String): String? = prim(key)?.contentOrNull

fun JsonObject.int(key: String): Int? {
    val p = prim(key) ?: return null
    return p.intOrNull ?: p.doubleOrNull?.toInt() ?: p.content.toIntOrNull()
}

fun JsonObject.double(key: String): Double? {
    val p = prim(key) ?: return null
    return p.doubleOrNull ?: p.content.toDoubleOrNull()
}

fun JsonObject.bool(key: String, default: Boolean = false): Boolean {
    val p = prim(key) ?: return default
    return p.booleanOrNull ?: p.intOrNull?.let { it != 0 } ?: (p.content == "true" || p.content == "1")
}

fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

fun JsonObject.strings(key: String): List<String> =
    (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeUnless { p -> p is JsonNull }?.content } ?: emptyList()

enum class MediaType(val key: String) { Movie("movie"), Episode("episode") }

// ── Accounts & profiles ──────────────────────────────────────────────────────

data class User(val id: Int, val username: String, val role: String) {
    companion object {
        fun from(o: JsonObject) = User(o.int("id") ?: 0, o.str("username") ?: "", o.str("role") ?: "user")
    }
}

data class Profile(
    val id: Int,
    val name: String,
    val avatarPath: String?,
    val isMain: Boolean,
    val isKids: Boolean,
    val hasPin: Boolean,
    /** What switching to this profile needs from the current one: "pin", "password" or null. */
    val requires: String?,
    /** Show titles and descriptions in English where available. */
    val englishTitles: Boolean,
    /** Preferred audio for files with several tracks: "default", "original" or a language code. */
    val audioLanguage: String = "default",
    /** Turn on English subtitles when the audio is in another language. */
    val autoSubtitles: Boolean = false,
) {
    companion object {
        fun from(o: JsonObject) = Profile(
            id = o.int("id") ?: 0,
            name = o.str("name") ?: "",
            avatarPath = o.str("avatar_url"),
            isMain = o.bool("is_main"),
            isKids = o.bool("is_kids"),
            hasPin = o.bool("has_pin"),
            requires = o.str("requires"),
            englishTitles = o.bool("english_titles"),
            audioLanguage = o.str("audio_language") ?: "default",
            autoSubtitles = o.bool("auto_subtitles"),
        )
    }
}

/** A finished sign-in: password, Admin Passphrase or an approved Quick Login. */
data class SignIn(val token: String, val user: User, val profile: Profile, val profileCount: Int)

data class QuickStart(val requestId: String, val code: String, val expiresIn: Int, val interval: Int) {
    companion object {
        fun from(o: JsonObject) = QuickStart(o.str("requestId") ?: "", o.str("code") ?: "", o.int("expiresIn") ?: 300, o.int("interval") ?: 3)
    }
}

/** Profile pictures the admin provides (Admin › Profile Pictures), as offered to one profile. */
data class AvatarCategory(val id: Int, val name: String, val images: List<AvatarChoice>) {
    companion object {
        fun from(o: JsonObject) = AvatarCategory(
            o.int("id") ?: 0, o.str("name") ?: "",
            o.objects("images").map { AvatarChoice(it.int("id") ?: 0, it.str("url") ?: "") },
        )
    }
}

data class AvatarChoice(val id: Int, val url: String)

// ── Library ──────────────────────────────────────────────────────────────────

data class Movie(
    val id: Int,
    val title: String,
    val year: Int?,
    val overview: String?,
    val posterPath: String?,
    val backdropPath: String?,
    val logoPath: String?,
    val rating: Double?,
    val contentRating: String?,
    val genres: List<String>,
    val duration: Int?,
    val watchCompleted: Boolean,
    val watchPosition: Int,
) {
    companion object {
        fun from(o: JsonObject) = Movie(
            id = o.int("id") ?: 0,
            title = o.str("title") ?: "Untitled",
            year = o.int("year"),
            overview = o.str("overview"),
            posterPath = o.str("poster_url"),
            backdropPath = o.str("backdrop_url"),
            logoPath = o.str("logo_url"),
            rating = o.double("rating"),
            contentRating = o.str("content_rating"),
            genres = o.strings("genres"),
            duration = o.int("duration"),
            watchCompleted = o.bool("watch_completed"),
            watchPosition = o.int("watch_position") ?: 0,
        )
    }
}

data class Show(
    val id: Int,
    val title: String,
    val overview: String?,
    val posterPath: String?,
    val backdropPath: String?,
    val firstAirDate: String?,
    val rating: Double?,
    val contentRating: String?,
    val genres: List<String>,
    val totalEpisodes: Int,
    val watchedEpisodes: Int,
    val logoPath: String?,
) {
    val year: String? get() = firstAirDate?.take(4)

    companion object {
        fun from(o: JsonObject) = Show(
            id = o.int("id") ?: 0,
            title = o.str("title") ?: "Untitled",
            overview = o.str("overview"),
            posterPath = o.str("poster_url"),
            backdropPath = o.str("backdrop_url"),
            firstAirDate = o.str("first_air_date"),
            rating = o.double("rating"),
            contentRating = o.str("content_rating"),
            genres = o.strings("genres"),
            totalEpisodes = o.int("total_episodes") ?: 0,
            watchedEpisodes = o.int("watched_episodes") ?: 0,
            logoPath = o.str("logo_url"),
        )
    }
}

data class Season(val season: Int, val episodeCount: Int, val watchedCount: Int) {
    val finished: Boolean get() = episodeCount > 0 && watchedCount >= episodeCount
    val label: String get() = if (season == 0) "Specials" else "Season $season"

    companion object {
        fun from(o: JsonObject) = Season(o.int("season") ?: 0, o.int("episode_count") ?: 0, o.int("watched_count") ?: 0)
    }
}

data class Episode(
    val id: Int,
    val season: Int,
    val episodeNumber: Int,
    val title: String?,
    val overview: String?,
    val stillPath: String?,
    val duration: Int?,
    val watchCompleted: Boolean,
    val watchPosition: Int,
) {
    val inProgress: Boolean get() = !watchCompleted && watchPosition > 10
    val label: String get() = "S$season E$episodeNumber"
    val displayTitle: String get() = title ?: "Episode $episodeNumber"

    companion object {
        fun from(o: JsonObject) = Episode(
            id = o.int("id") ?: 0,
            season = o.int("season") ?: 0,
            episodeNumber = o.int("episode_number") ?: 0,
            title = o.str("title"),
            overview = o.str("overview"),
            stillPath = o.str("still_url"),
            duration = o.int("duration"),
            watchCompleted = o.bool("watch_completed"),
            watchPosition = o.int("watch_position") ?: 0,
        )
    }
}

data class ContinueItem(
    val type: String,
    val mediaId: Int,
    val position: Int,
    val title: String,
    val subtitle: String?,
    val posterPath: String?,
    val backdropPath: String?,
    val duration: Int?,
) {
    val key: String get() = "$type-$mediaId"

    companion object {
        fun from(o: JsonObject) = ContinueItem(
            type = o.str("type") ?: "movie",
            mediaId = o.int("id") ?: 0,
            position = o.int("position") ?: 0,
            title = o.str("title") ?: "",
            subtitle = o.str("subtitle"),
            posterPath = o.str("poster_url"),
            backdropPath = o.str("backdrop_url"),
            duration = o.int("duration"),
        )
    }
}

data class WatchProgress(val position: Int, val completed: Boolean) {
    companion object {
        val None = WatchProgress(0, false)
        fun from(o: JsonObject) = WatchProgress(o.int("position") ?: 0, o.bool("completed"))
    }
}

data class CastMember(val id: Int, val name: String, val character: String?, val profilePath: String?) {
    companion object {
        fun from(o: JsonObject) = CastMember(o.int("id") ?: 0, o.str("name") ?: "", o.str("character"), o.str("profile_url"))
    }
}

data class MovieDetails(val movie: Movie, val cast: List<CastMember>, val director: String?, val similar: List<Movie>) {
    companion object {
        fun from(o: JsonObject): MovieDetails? {
            val movie = o.obj("movie") ?: return null
            return MovieDetails(
                Movie.from(movie),
                o.objects("cast").map(CastMember::from),
                o.str("director"),
                o.objects("similarLocal").map(Movie::from),
            )
        }
    }
}

data class ShowDetails(
    val show: Show,
    val seasons: List<Season>,
    val firstEpisodeId: Int?,
    val started: Boolean,
    val cast: List<CastMember>,
    val similar: List<Show>,
) {
    companion object {
        fun from(o: JsonObject): ShowDetails? {
            val show = o.obj("show") ?: return null
            return ShowDetails(
                Show.from(show),
                o.objects("seasons").map(Season::from),
                o.int("firstEpisodeId"),
                o.bool("started"),
                o.objects("cast").map(CastMember::from),
                o.objects("similarLocal").map(Show::from),
            )
        }
    }
}

data class NextEpisode(val id: Int, val season: Int, val episodeNumber: Int, val title: String?) {
    val label: String get() = "S$season E$episodeNumber" + (title?.let { " · $it" } ?: "")

    companion object {
        fun from(o: JsonObject) = NextEpisode(o.int("id") ?: 0, o.int("season") ?: 0, o.int("episode_number") ?: 0, o.str("title"))
    }
}

// ── Genres ───────────────────────────────────────────────────────────────────

data class GenreSummary(val name: String, val movieCount: Int, val showCount: Int, val imageUrl: String?) {
    companion object {
        fun from(o: JsonObject) = GenreSummary(o.str("name") ?: "", o.int("movie_count") ?: 0, o.int("show_count") ?: 0, o.str("image_url"))
    }
}

/** A movie or a show in a mixed grid (genres, search). */
sealed interface MediaItem {
    val key: String
    val title: String

    data class MovieItem(val movie: Movie) : MediaItem {
        override val key: String get() = "m${movie.id}"
        override val title: String get() = movie.title
    }

    data class ShowItem(val show: Show) : MediaItem {
        override val key: String get() = "s${show.id}"
        override val title: String get() = show.title
    }
}

// ── Subtitles ────────────────────────────────────────────────────────────────

data class SubtitleTrack(val id: String, val label: String, val language: String?, val forced: Boolean) {
    companion object {
        fun from(o: JsonObject) = SubtitleTrack(o.str("id") ?: "", o.str("label") ?: "Subtitles", o.str("language"), o.bool("forced"))
    }
}

// ── Audio tracks ─────────────────────────────────────────────────────────────

/** One of a file's audio tracks (e.g. Japanese and English on dual-audio anime); `index` is what the stream's `audio` takes. */
data class AudioTrack(val index: Int, val label: String, val language: String?, val codec: String?, val commentary: Boolean) {
    companion object {
        fun from(o: JsonObject): AudioTrack {
            val index = o.int("index") ?: 0
            return AudioTrack(index, o.str("label") ?: "Track ${index + 1}", o.str("language"), o.str("codec"), o.bool("commentary"))
        }
    }
}

/** Choices for a profile's Audio language setting. */
object AudioLanguage {
    val options = listOf(
        "default" to "File's default",
        "original" to "Original language",
        "en" to "English", "ja" to "Japanese", "es" to "Spanish", "fr" to "French", "de" to "German",
        "it" to "Italian", "pt" to "Portuguese", "ko" to "Korean", "zh" to "Chinese", "hi" to "Hindi", "ru" to "Russian",
    )

    fun name(code: String): String = options.firstOrNull { it.first == code }?.second ?: code.uppercase()
}

// ── Streaming services ───────────────────────────────────────────────────────

/** A streaming service (Netflix, Disney+…) on the Home row; Admin › Streaming Services decides its titles. */
data class StreamingService(
    val id: String,
    val name: String,
    /** The logo already coloured with the Streamulus gradient (transparent PNG). */
    val logoPng: String?,
    /** Width ÷ height of the logo. */
    val logoAspect: Double,
    val bannerUrl: String?,
    val movieCount: Int,
    val showCount: Int,
) {
    val titleCount: Int get() = movieCount + showCount

    companion object {
        fun from(o: JsonObject) = StreamingService(
            id = o.str("id") ?: "",
            name = o.str("name") ?: "",
            logoPng = o.str("logo_png"),
            logoAspect = o.double("logo_aspect") ?: 3.0,
            bannerUrl = o.str("banner_url"),
            movieCount = o.int("movie_count") ?: 0,
            showCount = o.int("show_count") ?: 0,
        )
    }
}

// ── Branding ─────────────────────────────────────────────────────────────────

/** Admin › Settings › Branding and Remote Access (GET /api/branding). */
data class Branding(
    val showLogo: Boolean = true,
    val showText: Boolean = true,
    /** An uploaded logo ("/uploads/branding/…"), or null for the built-in one. */
    val logoUrl: String? = null,
    /** The server's public address, e.g. a Tailscale Funnel URL. */
    val publicUrl: String? = null,
) {
    companion object {
        val Default = Branding()

        fun from(o: JsonObject): Branding {
            val logo = o.bool("showLogo", default = true)
            val text = o.bool("showText", default = true)
            return Branding(logo, text || !logo, o.str("logoUrl"), o.str("publicUrl"))
        }
    }
}

// ── Feedback ─────────────────────────────────────────────────────────────────

/** Feedback or an app suggestion: a conversation with the server's admin. Times in ms. */
data class FeedbackItem(
    val id: Int,
    val kind: String,
    val status: String,
    val createdAt: Long,
    val updatedAt: Long,
    val preview: String,
    val unread: Boolean,
    val messages: List<FeedbackMessage>,
) {
    val kindLabel: String get() = if (kind == "suggestion") "App Suggestion" else "Feedback"
    val statusLabel: String
        get() = when (status) {
            "answered" -> "Answered"
            "closed" -> "Closed"
            else -> "Waiting for reply"
        }

    companion object {
        fun from(o: JsonObject) = FeedbackItem(
            id = o.int("id") ?: 0,
            kind = o.str("kind") ?: "feedback",
            status = o.str("status") ?: "open",
            createdAt = o.double("createdAt")?.toLong() ?: 0L,
            updatedAt = o.double("updatedAt")?.toLong() ?: 0L,
            preview = o.str("preview") ?: "",
            unread = o.bool("unread"),
            messages = o.objects("messages").map {
                FeedbackMessage(
                    id = it.int("id") ?: 0,
                    fromAdmin = it.bool("fromAdmin"),
                    author = it.str("author"),
                    body = it.str("body") ?: "",
                    createdAt = it.double("createdAt")?.toLong() ?: 0L,
                )
            },
        )
    }
}

data class FeedbackMessage(val id: Int, val fromAdmin: Boolean, val author: String?, val body: String, val createdAt: Long)
