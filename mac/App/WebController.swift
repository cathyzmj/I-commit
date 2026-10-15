import AppKit
import AuthenticationServices
import WebKit
import WidgetKit

/// Hosts the web app (at AppHost from Info.plist, set in Local.xcconfig) in a WKWebView and bridges it to the Mac:
/// widget updates, Save/Open panels, alerts, opening outside links in their own apps, and passkeys
/// (through Apple's sign-in window, since a web view inside an app can't use them on its own).
@MainActor
final class WebController: NSObject, ObservableObject {
    static let home: URL = {
        let host = Bundle.main.object(forInfoDictionaryKey: "AppHost") as? String ?? ""
        return URL(string: "https://\(host)/")!
    }()
    let webView: WKWebView
    private var authSession: ASWebAuthenticationSession?

    /// Injected into the page: whenever the app's data changes, send the widget summary to Swift.
    /// widgetSnapshot() and state are globals defined by the page's app.js.
    private static let bridgeScript = """
    (() => {
      let last = '';
      function send() {
        try {
          if (typeof widgetSnapshot !== 'function' || typeof state === 'undefined' || !state) return;
          const snap = widgetSnapshot();
          const { updatedAt, ...rest } = snap;
          const sig = JSON.stringify(rest);
          if (sig === last) return;
          last = sig;
          window.webkit.messageHandlers.native.postMessage({ type: 'snapshot', json: JSON.stringify(snap) });
        } catch (e) { /* page still loading */ }
      }
      setInterval(send, 3000);
      document.addEventListener('visibilitychange', send);
      window.addEventListener('hashchange', send);
    })();
    """

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "CommitmentsMac/1.0"
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = content
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        content.add(WeakMessageHandler(self), name: "native")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: URL(string: "#/today", relativeTo: Self.home)!))
    }

    /// commitments://today, commitments://week, commitments://cal, commitments://commitments
    func open(_ url: URL) {
        guard url.scheme == "commitments" else { return }
        go(url.host ?? "today")
        NSApp.activate()
    }

    func go(_ page: String) {
        let safe = page.filter { $0.isLetter }
        webView.evaluateJavaScript("location.hash = '#/\(safe.isEmpty ? "today" : safe)'")
    }

    func reload() {
        if webView.url?.host == Self.home.host { webView.reload() } else { webView.load(URLRequest(url: Self.home)) }
    }

    fileprivate func received(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch body["type"] as? String {
        case "snapshot":
            guard let json = body["json"] as? String, let data = json.data(using: .utf8) else { return }
            if let error = SnapshotStore.save(data) { NSLog("Commitments: couldn't save widget data: \(error)") }
            WidgetCenter.shared.reloadAllTimelines()
        case "passkey":
            startPasskey(mode: body["mode"] as? String ?? "signin", key: body["key"] as? String ?? "")
        default:
            break
        }
    }

    /// Opens the site's passkey page in Apple's sign-in window (Safari underneath, so Touch ID and
    /// iCloud Keychain passkeys work). The page finishes on commitments://passkey#…, which only this
    /// session receives, and the result goes back to the page as window.nativePasskeyDone(…).
    private func startPasskey(mode: String, key: String) {
        let safeKey = key.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        let path = mode == "add" ? "#/passkey/add/\(safeKey)" : "#/passkey/signin"
        guard let url = URL(string: path, relativeTo: Self.home)?.absoluteURL else { return }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "commitments") { [weak self] callback, error in
            Task { @MainActor in
                guard let self else { return }
                self.authSession = nil
                var result: [String: String] = [:]
                if let callback, let fragment = callback.fragment,
                   let items = URLComponents(string: "?" + fragment)?.queryItems {
                    for item in items { result[item.name] = item.value ?? "" }
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    return // closed the window: nothing to report
                } else if let error {
                    result["error"] = error.localizedDescription
                }
                self.finishPasskey(result)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = true
        authSession = session
        if !session.start() { finishPasskey(["error": "Couldn't open the sign-in window."]) }
    }

    private func finishPasskey(_ result: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.nativePasskeyDone && window.nativePasskeyDone(\(json))")
    }

    private func showOffline() {
        let html = """
        <html><body style="font:15px -apple-system;display:flex;align-items:center;justify-content:center;height:90vh;color:#6b716e;text-align:center">
        <div><h2 style="color:#1b1f1d">Can’t reach Commitments</h2><p>Check your internet connection.</p>
        <p><a href="\(Self.home.absoluteString)" style="color:#1d7a5f">Try again</a></p></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}

// MARK: - Navigation: keep the app's own pages inside, open everything else in its own app.
extension WebController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { decisionHandler(.download); return }
        guard let url = action.request.url else { decisionHandler(.allow); return }
        if ["blob", "data", "about"].contains(url.scheme ?? "") || url.host == Self.home.host {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url) // Notion, course sites, Google Calendar…
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showOffline() }
    }
}

// MARK: - Downloads (Excel export, JSON backup) go through a Save panel.
extension WebController: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.begin { result in completionHandler(result == .OK ? panel.url : nil) }
    }
}

// MARK: - alert(), confirm(), file pickers and target=_blank links.
extension WebController: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
}

// MARK: - Apple's sign-in window sits over the app's window.
extension WebController: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    }
}

/// Avoids a retain cycle between WKUserContentController and the controller.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WebController?
    init(_ target: WebController) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { target?.received(message) }
    }
}
