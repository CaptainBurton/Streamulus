// Copied from shared/apple/StreamulusCore/AnimatedImage.swift by generate_project.rb.
// Edit the original there, then run generate_project.rb for both apps.

import SwiftUI
import UIKit
import ImageIO

/// Profile picture from the server as a still image — for a GIF, its first
/// frame. (Decoded with AnimatedImageLoader, which also reads GIF/APNG/WebP.)
struct RemotePicture: View {
    let url: URL?
    /// Decoded at no more than this many pixels across.
    var maxPixelSize: CGFloat = 512
    /// .fill for profile pictures, .fit for logos.
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            }
        }
        .task(id: url) {
            image = nil
            guard let url else { return }
            let loaded = await AnimatedImageLoader.load(url, maxPixelSize: maxPixelSize)
            image = loaded?.images?.first ?? loaded
        }
    }
}

enum AnimatedImageLoader {
    private static let cache = NSCache<NSString, UIImage>()

    static func load(_ url: URL, maxPixelSize: CGFloat) async -> UIImage? {
        let key = "\(url.absoluteString)#\(Int(maxPixelSize))" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        let result = try? await URLSession.shared.data(from: url)
        guard let result else { return nil }
        let data = result.0
        let image = await Task.detached(priority: .userInitiated) {
            decode(data, maxPixelSize: maxPixelSize)
        }.value
        if let image { cache.setObject(image, forKey: key) }
        return image
    }

    /// A still image, or an animated UIImage with the file's own frame timing.
    static func decode(_ data: Data, maxPixelSize: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return UIImage(data: data) }
        let count = CGImageSourceGetCount(source)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        if count <= 1 {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return UIImage(data: data) }
            return UIImage(cgImage: frame)
        }

        // Long animations: skip frames evenly so memory stays reasonable.
        let maxFrames = 180
        let step = max(1, Int((Double(count) / Double(maxFrames)).rounded(.up)))
        var frames: [UIImage] = []
        var duration: Double = 0
        for index in stride(from: 0, to: count, by: step) {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary) else { continue }
            frames.append(UIImage(cgImage: frame))
            for skipped in index..<min(index + step, count) { duration += frameDelay(source, at: skipped) }
        }
        guard !frames.isEmpty else { return UIImage(data: data) }
        return UIImage.animatedImage(with: frames, duration: duration) ?? frames.first
    }

    /// Seconds this frame is shown, from the GIF / APNG / WebP metadata.
    private static func frameDelay(_ source: CGImageSource, at index: Int) -> Double {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any] else { return 0.1 }
        let containers: [(CFString, CFString, CFString)] = [
            (kCGImagePropertyGIFDictionary, kCGImagePropertyGIFUnclampedDelayTime, kCGImagePropertyGIFDelayTime),
            (kCGImagePropertyPNGDictionary, kCGImagePropertyAPNGUnclampedDelayTime, kCGImagePropertyAPNGDelayTime),
            (kCGImagePropertyWebPDictionary, kCGImagePropertyWebPUnclampedDelayTime, kCGImagePropertyWebPDelayTime),
        ]
        for (dictionaryKey, unclampedKey, delayKey) in containers {
            guard let info = properties[dictionaryKey] as? [CFString: Any] else { continue }
            let delay = (info[unclampedKey] as? Double) ?? (info[delayKey] as? Double) ?? 0.1
            // Browsers treat very short delays as 0.1 s; do the same so GIFs play at the familiar speed.
            return delay < 0.02 ? 0.1 : delay
        }
        return 0.1
    }
}
