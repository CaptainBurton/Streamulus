import SwiftUI

/// Choose one of the profile pictures the admin provides (Admin › Profile Pictures
/// on the web). Only pictures meant for this profile — Streamer or Streamling —
/// are offered; it's how Streamlings change their picture.
struct AvatarPickerView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var categories: [AvatarCategory] = []
    @State private var currentId: Int?
    @State private var shownCategory: Int? // nil for all
    @State private var loading = true
    @State private var busyId: Int?
    @State private var errorText: String?

    var body: some View {
        let size: CGFloat = sizeClass == .regular ? 100 : 78
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if categories.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("All", selected: shownCategory == nil) { shownCategory = nil }
                            ForEach(categories) { category in
                                chip(category.name, selected: shownCategory == category.id) { shownCategory = category.id }
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
                if let errorText {
                    Label(errorText, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal, 20)
                }
                ForEach(categories.filter { shownCategory == nil || $0.id == shownCategory }) { category in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(category.name.uppercased())
                            .font(.footnote.weight(.bold))
                            .tracking(1)
                            .foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: size), spacing: 14)], spacing: 16) {
                            ForEach(category.images) { image in
                                Button {
                                    Task { await pick(image) }
                                } label: {
                                    tile(image, size: size)
                                }
                                .buttonStyle(.plain)
                                .disabled(busyId != nil)
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
            .padding(.vertical, 16)
        }
        .overlay {
            if loading {
                ProgressView()
            } else if categories.isEmpty && errorText == nil {
                ContentUnavailableView("No pictures yet", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("Your Streamulus admin can add profile pictures in Admin › Profile Pictures on the web."))
            }
        }
        .navigationTitle("Choose a Picture")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func tile(_ image: AvatarChoice, size: CGFloat) -> some View {
        let current = image.id == currentId
        return ZStack {
            Circle().fill(Color.white.opacity(0.08))
            RemotePicture(url: session.imageURL(image.url), maxPixelSize: size * 3)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.accent, lineWidth: current ? 3 : 0))
        .overlay(alignment: .bottomTrailing) {
            if current {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Theme.accent)
                    .background(Circle().fill(Color.black).padding(2))
            }
        }
        .overlay {
            if busyId == image.id { ProgressView().tint(.white) }
        }
        .opacity(busyId != nil && busyId != image.id ? 0.5 : 1)
        .frame(maxWidth: .infinity)
        .contentShape(Circle())
        .accessibilityLabel(current ? "Current picture" : "Profile picture")
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .foregroundStyle(selected ? Color.black : Color.primary)
                .background(selected ? Color.white : Color.clear, in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(selected ? 0 : 0.25)))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        do {
            let choices = try await session.avatarChoices()
            categories = choices.categories
            currentId = choices.currentImageId
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        loading = false
    }

    private func pick(_ image: AvatarChoice) async {
        busyId = image.id
        errorText = nil
        do {
            try await session.chooseAvatar(image.id)
            currentId = image.id
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
        busyId = nil
    }
}
