import Foundation

/// An error returned by the Streamulus server ({ "error": "...", "code": "..." }).
struct APIError: LocalizedError {
    let status: Int
    let message: String
    let code: String?

    var errorDescription: String? { message }
}

/// Decodes any JSON body we don't need the contents of (e.g. { "success": true }).
struct Empty: Decodable {}

/// Thin JSON client for the Streamulus REST API.
final class APIClient {
    let baseURL: URL
    var token: String?

    private let session: URLSession
    /// For requests the server may take minutes to answer (subtitle extraction).
    private static let longSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 600
        return URLSession(configuration: config)
    }()
    private let decoder = JSONDecoder()

    init(baseURL: URL, token: String? = nil) {
        self.baseURL = baseURL
        self.token = token
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config)
    }

    /// Absolute URL for a server path such as "/api/movies".
    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = basePath + path
        components.queryItems = query.isEmpty ? nil : query
        return components.url!
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await send(method: "GET", path: path, query: query, body: nil)
    }

    func post<T: Decodable>(_ path: String, body: [String: Any] = [:], as type: T.Type = T.self) async throws -> T {
        try await send(method: "POST", path: path, query: [], body: body)
    }

    /// A text response (e.g. WebVTT subtitles). `timeout` is generous because the
    /// server may need to read a whole video file the first time.
    func getText(_ path: String, timeout: TimeInterval = 600) async throws -> String {
        let data = try await sendData(method: "GET", path: path, query: [], body: nil, timeout: timeout)
        return String(decoding: data, as: UTF8.self)
    }

    private func send<T: Decodable>(method: String, path: String, query: [URLQueryItem], body: [String: Any]?) async throws -> T {
        let data = try await sendData(method: method, path: path, query: query, body: body, timeout: nil)
        return try decoder.decode(T.self, from: data)
    }

    private func sendData(method: String, path: String, query: [URLQueryItem], body: [String: Any]?, timeout: TimeInterval?) async throws -> Data {
        var request = URLRequest(url: url(path, query: query))
        if let timeout { request.timeoutInterval = timeout }
        // The shared session gives up after 20 s without data; long requests use their own.
        let urlSession = timeout == nil ? session : Self.longSession
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await urlSession.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw APIError(
                status: status,
                message: json?["error"] as? String ?? "The server returned an error (\(status)).",
                code: json?["code"] as? String
            )
        }
        return data
    }
}
