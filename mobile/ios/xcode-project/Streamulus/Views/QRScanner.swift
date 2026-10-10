import AVFoundation
import SwiftUI
import UIKit

/// Full-screen camera for scanning the Quick Login QR code an Apple TV or browser
/// shows. Calls `onCode` with the 6-character code and closes.
struct QRScanSheet: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var access = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var notACode = false

    private var hasCamera: Bool { AVCaptureDevice.default(for: .video) != nil }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if !hasCamera {
                    unavailable("No camera", systemImage: "camera.fill",
                                text: "This device has no camera. Type the code instead.")
                } else {
                    switch access {
                    case .authorized:
                        QRScannerView { text in
                            if let code = Self.quickLoginCode(from: text) {
                                UINotificationFeedbackGenerator().notificationOccurred(.success)
                                onCode(code)
                                dismiss()
                            } else {
                                notACode = true
                            }
                        }
                        .ignoresSafeArea()
                        viewfinder
                    case .notDetermined:
                        ProgressView().tint(.white)
                    default:
                        unavailable("Camera access is off", systemImage: "camera.fill",
                                    text: "Allow Streamulus to use the camera in Settings to scan sign-in QR codes, or type the code instead.",
                                    showSettings: true)
                    }
                }
            }
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                if access == .notDetermined {
                    let granted = await AVCaptureDevice.requestAccess(for: .video)
                    access = granted ? .authorized : .denied
                }
            }
        }
    }

    /// A clear square to aim with, and a hint underneath.
    private var viewfinder: some View {
        VStack(spacing: 28) {
            Spacer()
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white, lineWidth: 4)
                .frame(width: 250, height: 250)
                .shadow(color: .black.opacity(0.4), radius: 10)
            Text(notACode ? "That QR code isn't a Streamulus sign-in code." : "Point at the QR code on the TV or browser that's signing in.")
                .font(.callout.weight(.medium))
                .multilineTextAlignment(.center)
                .foregroundStyle(notACode ? Color.yellow : Color.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
                .padding(.horizontal, 30)
            Spacer()
        }
        .allowsHitTesting(false)
    }

    private func unavailable(_ title: String, systemImage: String, text: String, showSettings: Bool = false) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(text)
        } actions: {
            if showSettings, let url = URL(string: UIApplication.openSettingsURLString) {
                Button("Open Settings") { openURL(url) }
                    .buttonStyle(.glassProminent)
            }
        }
        .foregroundStyle(.white)
    }

    /// The code from a Quick Login QR code — a link like
    /// `http://server:8096/quick-login?code=ABC234` — or a bare code.
    static func quickLoginCode(from text: String) -> String? {
        let clean: (String) -> String = { $0.uppercased().filter { $0.isLetter || $0.isNumber } }
        if let item = URLComponents(string: text)?.queryItems?.first(where: { $0.name.lowercased() == "code" }),
           let value = item.value {
            let code = clean(value)
            return code.count == 6 ? code : nil
        }
        let code = clean(text)
        return code.count == 6 ? code : nil
    }
}

/// Camera preview that reports each new QR code it reads.
struct QRScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerController {
        let controller = QRScannerController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ controller: QRScannerController, context: Context) {
        controller.onCode = onCode
    }

    static func dismantleUIViewController(_ controller: QRScannerController, coordinator: ()) {
        controller.stop()
    }
}

final class QRScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    private let captureSession = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "streamulus.qr-scanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var lastCode: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              captureSession.canAddInput(input) else { return }
        captureSession.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else { return }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: captureSession)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        previewLayer = layer
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = captureSession
        sessionQueue.async {
            if !session.isRunning { session.startRunning() }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stop()
    }

    func stop() {
        let session = captureSession
        sessionQueue.async {
            if session.isRunning { session.stopRunning() }
        }
    }

    // Delivered on the main queue (see setMetadataObjectsDelegate above).
    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput,
                                    didOutput metadataObjects: [AVMetadataObject],
                                    from connection: AVCaptureConnection) {
        let value = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue
        guard let value else { return }
        MainActor.assumeIsolated {
            // The same code is reported many times a second; act on it once.
            guard value != lastCode else { return }
            lastCode = value
            onCode?(value)
        }
    }
}
