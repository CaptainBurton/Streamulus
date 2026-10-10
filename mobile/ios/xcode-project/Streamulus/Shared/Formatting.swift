// Shared with the Apple TV app — tv/appletv/generate_project.rb copies this folder into
// its project. Edit it here, then run that script to update the Apple TV copy.

import SwiftUI
import CoreImage.CIFilterBuiltins

enum Theme {
    static let accent = Color(red: 0.0, green: 0.76, blue: 1.0)      // #00C2FF
    static let purple = Color(red: 0.48, green: 0.18, blue: 1.0)     // #7B2FFF
    static let streamling = Color(red: 1.0, green: 0.72, blue: 0.01) // #FFB703
    static let background = Color(red: 0.06, green: 0.06, blue: 0.06)
    static let logoGradient = LinearGradient(colors: [accent, purple], startPoint: .leading, endPoint: .trailing)
}

enum Fmt {
    /// 7500 → "2h 5m", 2520 → "42m"
    static func runtime(_ seconds: Int) -> String {
        let minutes = max(1, Int((Double(seconds) / 60).rounded()))
        let hours = minutes / 60
        return hours > 0 ? "\(hours)h \(minutes % 60)m" : "\(minutes)m"
    }

    /// When something `remaining` seconds long finishes if started at `now`, e.g. "8:00 PM".
    static func endsAt(_ remaining: Int, from now: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: now.addingTimeInterval(TimeInterval(remaining)))
    }

    /// 3725 → "1:02:05", 300 → "5:00"
    static func clock(_ seconds: Int) -> String {
        let h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// "ABC234" → "ABC-234"
    static func code(_ code: String) -> String {
        code.count == 6 ? "\(code.prefix(3))-\(code.suffix(3))" : code
    }
}

enum QRCode {
    /// A crisp QR code image for `string`, or nil if it can't be generated.
    static func image(for string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
