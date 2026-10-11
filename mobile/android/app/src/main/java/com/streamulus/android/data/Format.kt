package com.streamulus.android.data

import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

object Fmt {
    /** 7500 → "2h 5m", 2520 → "42m" */
    fun runtime(seconds: Int): String {
        val minutes = maxOf(1, (seconds / 60.0).roundToInt())
        val hours = minutes / 60
        return if (hours > 0) "${hours}h ${minutes % 60}m" else "${minutes}m"
    }

    /** When something `remaining` seconds long finishes if started now, e.g. "8:00 PM". */
    fun endsAt(remaining: Int, now: LocalTime = LocalTime.now()): String =
        now.plusSeconds(remaining.toLong()).format(DateTimeFormatter.ofPattern("h:mm a", Locale.US))

    /** 3725 → "1:02:05", 300 → "5:00" */
    fun clock(seconds: Int): String {
        val s = maxOf(0, seconds)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, sec) else String.format(Locale.US, "%d:%02d", m, sec)
    }

    /** "ABC234" → "ABC-234" */
    fun code(code: String): String = if (code.length == 6) "${code.take(3)}-${code.takeLast(3)}" else code
}

data class SubtitleCue(val start: Double, val end: Double, val lines: List<String>)

/** Minimal WebVTT reader for the player's own subtitle overlay. Cue times are the video file's own times. */
object WebVTT {
    fun parse(text: String): List<SubtitleCue> {
        val normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        val cues = mutableListOf<SubtitleCue>()
        for (block in normalized.split("\n\n")) {
            val lines = block.split("\n")
            val at = lines.indexOfFirst { it.contains("-->") }
            if (at < 0) continue
            val parts = lines[at].split("-->")
            if (parts.size != 2) continue
            val start = seconds(parts[0]) ?: continue
            val end = seconds(parts[1].trim().split(" ").firstOrNull() ?: "") ?: continue
            if (end <= start) continue
            val body = lines.drop(at + 1).map(::clean).filter { it.isNotBlank() }
            if (body.isNotEmpty()) cues.add(SubtitleCue(start, end, body))
        }
        return cues.sortedBy { it.start }
    }

    /** Lines of every cue showing at `time`. */
    fun linesAt(cues: List<SubtitleCue>, time: Double): List<String> {
        // First cue starting after `time`, then look back over the few before it.
        var low = 0
        var high = cues.size
        while (low < high) {
            val mid = (low + high) / 2
            if (cues[mid].start > time) high = mid else low = mid + 1
        }
        val result = ArrayDeque<String>()
        var index = low - 1
        while (index >= 0 && index >= low - 8) {
            if (cues[index].end > time) cues[index].lines.asReversed().forEach { result.addFirst(it) }
            index--
        }
        return result.toList()
    }

    private fun seconds(stamp: String): Double? {
        val parts = stamp.trim().split(":").map { it.toDoubleOrNull() ?: return null }
        return when (parts.size) {
            3 -> parts[0] * 3600 + parts[1] * 60 + parts[2]
            2 -> parts[0] * 60 + parts[1]
            else -> null
        }
    }

    private val tags = Regex("<[^>]+>")

    private fun clean(line: String): String = line.replace(tags, "")
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
}
