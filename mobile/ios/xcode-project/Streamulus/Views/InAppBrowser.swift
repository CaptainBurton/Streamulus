import SafariServices
import SwiftUI

/// A web page opened inside the app (Safari's in-app browser, like links in
/// Messages or Messenger) instead of switching to Safari. Done closes it.
struct InAppBrowser: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.barCollapsingEnabled = true
        let controller = SFSafariViewController(url: url, configuration: configuration)
        controller.preferredControlTintColor = UIColor(Theme.accent)
        controller.dismissButtonStyle = .done
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// The page to show in an `.inAppBrowser(_:)` cover.
struct BrowserPage: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

extension View {
    /// Shows `page` in the in-app browser while it's set; cleared when it's closed.
    func inAppBrowser(_ page: Binding<BrowserPage?>) -> some View {
        fullScreenCover(item: page) { page in
            InAppBrowser(url: page.url).ignoresSafeArea()
        }
    }
}
