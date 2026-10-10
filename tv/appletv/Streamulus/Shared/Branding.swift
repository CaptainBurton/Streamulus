// Copied from mobile/ios/xcode-project/Streamulus/Shared/Branding.swift by generate_project.rb.
// Edit the original there, then run tv/appletv/generate_project.rb.

import SwiftUI

/// The Streamulus logo and/or wordmark, following Admin › Settings › Branding:
/// the built-in logo (asset "StreamulusLogo") or the admin's uploaded one, and
/// the STREAMULUS text — either or both.
struct BrandMark: View {
    /// Text size; the logo is a little taller.
    var size: CGFloat = 40
    @EnvironmentObject private var session: Session

    var body: some View {
        HStack(spacing: size * 0.35) {
            if session.branding.showLogo {
                Group {
                    if let custom = session.imageURL(session.branding.logoUrl) {
                        RemotePicture(url: custom, maxPixelSize: size * 6, contentMode: .fit)
                    } else {
                        Image("StreamulusLogo").resizable().scaledToFit()
                    }
                }
                .frame(width: size * 1.35, height: size * 1.35)
                .accessibilityLabel("Streamulus")
            }
            if session.branding.showText {
                Text("STREAMULUS")
                    .font(.system(size: size, weight: .heavy))
                    .foregroundStyle(Theme.logoGradient)
                    .fixedSize()
            }
        }
    }
}
