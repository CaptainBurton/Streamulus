import SwiftUI

/// Profile & Settings › Feedback: send feedback or an app suggestion to the server's
/// admin, and read and answer their replies (Admin › Feedback on the web).
struct FeedbackView: View {
    @EnvironmentObject private var session: Session
    @State private var items: [FeedbackItem] = []
    @State private var loading = true
    @State private var errorText: String?
    @State private var composing = false

    var body: some View {
        List {
            Section {
                Button {
                    composing = true
                } label: {
                    Label("Send Feedback or a Suggestion", systemImage: "square.and.pencil")
                        .font(.headline)
                }
            } footer: {
                Text("Tell your Streamulus admin what you think, report something that isn't working, or suggest something for the apps. Their replies show up here.")
            }

            if let errorText {
                Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            }

            if !items.isEmpty {
                Section("Your messages") {
                    ForEach(items) { item in
                        NavigationLink {
                            FeedbackThreadView(item: item) { updated in
                                if let index = items.firstIndex(where: { $0.id == updated.id }) { items[index] = updated }
                            }
                        } label: {
                            FeedbackRow(item: item)
                        }
                    }
                }
            } else if !loading && errorText == nil {
                Section {
                    Text("Nothing yet — anything you send appears here, with the admin's replies.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .overlay { if loading && items.isEmpty { ProgressView() } }
        .navigationTitle("Feedback")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $composing) {
            NavigationStack {
                FeedbackComposer { item in
                    items.insert(item, at: 0)
                }
            }
            .environmentObject(session)
            .presentationDetents([.medium, .large])
        }
    }

    private func load() async {
        do {
            items = try await session.feedback().items
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        loading = false
    }
}

private struct FeedbackRow: View {
    let item: FeedbackItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Theme.accent)
                .frame(width: 9, height: 9)
                .padding(.top, 6)
                .opacity(item.unread ? 1 : 0)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(item.kindLabel).font(.subheadline.weight(.semibold))
                    FeedbackStatus(status: item.status, label: item.statusLabel)
                    Spacer(minLength: 0)
                    Text(item.updated, format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(item.preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if item.unread {
                    Text("New reply").font(.caption.weight(.bold)).foregroundStyle(Theme.accent)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

private struct FeedbackStatus: View {
    let status: String
    let label: String

    private var color: Color {
        switch status {
        case "answered": return .green
        case "closed": return .gray
        default: return Theme.streamling
        }
    }

    var body: some View {
        Text(label)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .overlay(Capsule().stroke(color.opacity(0.4)))
    }
}

/// Write new feedback or an app suggestion.
struct FeedbackComposer: View {
    let onSent: (FeedbackItem) -> Void
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "feedback"
    @State private var message = ""
    @State private var busy = false
    @State private var errorText: String?
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                Picker("Type", selection: $kind) {
                    Text("Feedback").tag("feedback")
                    Text("App Suggestion").tag("suggestion")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                TextField(kind == "suggestion" ? "What would make Streamulus better?" : "What's on your mind? If something isn't working, say what you were doing.",
                          text: $message, axis: .vertical)
                    .lineLimit(5...12)
                    .focused($focused)
            } footer: {
                Text("\(message.count)/4000")
            }
            if let errorText {
                Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            }
        }
        .navigationTitle(kind == "suggestion" ? "App Suggestion" : "Feedback")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await send() }
                } label: {
                    if busy { ProgressView() } else { Text("Send").bold() }
                }
                .disabled(busy || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || message.count > 4000)
            }
        }
        .onAppear { focused = true }
    }

    private func send() async {
        busy = true
        errorText = nil
        do {
            let item = try await session.sendFeedback(kind: kind, message: message.trimmingCharacters(in: .whitespacesAndNewlines))
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onSent(item)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }
}

/// One conversation as chat bubbles, with a reply bar.
struct FeedbackThreadView: View {
    @State var item: FeedbackItem
    let onChange: (FeedbackItem) -> Void
    @EnvironmentObject private var session: Session
    @State private var reply = ""
    @State private var busy = false
    @State private var errorText: String?

    init(item: FeedbackItem, onChange: @escaping (FeedbackItem) -> Void) {
        _item = State(initialValue: item)
        self.onChange = onChange
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    HStack(spacing: 8) {
                        Text(item.kindLabel).font(.subheadline.weight(.semibold))
                        FeedbackStatus(status: item.status, label: item.statusLabel)
                    }
                    .padding(.top, 8)
                    ForEach(item.messages) { message in
                        Bubble(message: message).id(message.id)
                    }
                    if let errorText {
                        Text(errorText).font(.footnote).foregroundStyle(.red)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .onAppear {
                if let last = item.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
            }
            .onChange(of: item.messages.count) { _, _ in
                if let last = item.messages.last?.id {
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField(item.status == "closed" ? "Reply to open this again…" : "Reply…", text: $reply, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: .rect(cornerRadius: 20))
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: busy ? "ellipsis" : "arrow.up")
                        .font(.headline)
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(busy || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Send reply")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .navigationTitle(item.kindLabel)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard item.unread else { return }
            await session.markFeedbackRead(item.id)
            if let fresh = try? await session.feedback().items.first(where: { $0.id == item.id }) {
                item = fresh
                onChange(fresh)
            }
        }
    }

    private func send() async {
        busy = true
        errorText = nil
        do {
            let updated = try await session.replyToFeedback(item.id, message: reply.trimmingCharacters(in: .whitespacesAndNewlines))
            reply = ""
            item = updated
            onChange(updated)
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }
}

private struct Bubble: View {
    let message: FeedbackMessage

    var body: some View {
        let mine = !message.fromAdmin
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            Text(message.body)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(mine ? Theme.accent.opacity(0.22) : Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .textSelection(.enabled)
            Text("\(message.fromAdmin ? "\(message.author ?? "Admin") (admin)" : (message.author ?? "You")) · \(message.date.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 40)
    }
}
