import SafariServices
import UIKit
import WebKit
import WidgetKit

/// Hosts the web app (at AppHost from Info.plist, set in Local.xcconfig) in a WKWebView and bridges it to
/// the iPhone: widget updates, alerts and confirms, Google sign-in in an in-app Safari sheet, and every
/// other outside link in its own app.
@MainActor
final class WebController: NSObject, ObservableObject {
    static let home: URL = {
        #if DEBUG
        // Testing against a server on this Mac: launch with  -home http://localhost:8766/
        if let local = UserDefaults.standard.string(forKey: "home"), let url = URL(string: local) { return url }
        #endif
        let host = Bundle.main.object(forInfoDictionaryKey: "AppHost") as? String ?? ""
        return URL(string: "https://\(host)/")!
    }()
    let webView: WKWebView
    private weak var signInSheet: SFSafariViewController?

    /// Injected into the page: send the widget summary whenever the app's data changes, and say when a
    /// sign-in has finished so the Safari sheet can close itself.
    /// widgetSnapshot() and state are globals defined by the page's app.js.
    private static let bridgeScript = """
    (() => {
      let last = '', signedIn = null;
      function send() {
        try {
          if (typeof state === 'undefined' || !state) return;
          const now = !!state.account;
          if (signedIn === false && now) window.webkit.messageHandlers.native.postMessage({ type: 'signedin' });
          signedIn = now;
          if (typeof widgetSnapshot !== 'function') return;
          const snap = widgetSnapshot();
          const { updatedAt, ...rest } = snap;
          const sig = JSON.stringify(rest);
          if (sig === last) return;
          last = sig;
          window.webkit.messageHandlers.native.postMessage({ type: 'snapshot', json: JSON.stringify(snap) });
        } catch (e) { /* page still loading */ }
      }
      setInterval(send, 2000);
      document.addEventListener('visibilitychange', send);
      window.addEventListener('hashchange', send);
    })();
    """

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "ICommitApp/1.0"
        // Needed for the offline copy (service worker); see WKAppBoundDomains in Info.plist.
        config.limitsNavigationsToAppBoundDomains = Self.home.scheme == "https"
        config.allowsInlineMediaPlayback = true
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = content
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        content.add(WeakMessageHandler(self), name: "native")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.load(URLRequest(url: Self.home))
    }

    /// commitments://plan, commitments://today, commitments://cal …
    func open(_ url: URL) {
        guard url.scheme == "commitments" else { return }
        let page = (url.host ?? "plan").filter { $0.isLetter }
        webView.evaluateJavaScript("location.hash = '#/\(page.isEmpty ? "plan" : page)'")
    }

    /// Google refuses to sign in inside a web view, so it opens in Safari's own sheet; the page keeps
    /// running behind it and notices when you're done. Other links go to their apps.
    private func openOutside(_ url: URL) {
        if url.host == "accounts.google.com" || url.path.hasPrefix("/api/login/") {
            let safari = SFSafariViewController(url: url)
            signInSheet = safari
            present(safari)
        } else {
            UIApplication.shared.open(url)
        }
    }

    private func present(_ controller: UIViewController) {
        var top = webView.window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        top?.present(controller, animated: true)
    }

    fileprivate func received(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch body["type"] as? String {
        case "snapshot":
            guard let json = body["json"] as? String, let data = json.data(using: .utf8) else { return }
            if let error = SnapshotStore.save(data) { NSLog("I Commit: couldn't save widget data: \(error)") }
            WidgetCenter.shared.reloadAllTimelines()
        case "signedin":
            signInSheet?.dismiss(animated: true)
        default:
            break
        }
    }

    private func showOffline() {
        let html = """
        <html><meta name="viewport" content="width=device-width"><body style="font:17px -apple-system;display:flex;align-items:center;justify-content:center;height:90vh;color:#6b716e;text-align:center;padding:24px">
        <div><h2 style="color:#1b1f1d">Can’t reach I Commit!</h2><p>Check your internet connection.</p>
        <p><a href="\(Self.home.absoluteString)" style="color:#1d7a5f">Try again</a></p></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: Self.home)
    }
}

// MARK: - Navigation: keep the app's own pages inside, open everything else outside.
extension WebController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.allow); return }
        let ours = url.host == Self.home.host && url.port == Self.home.port
        if ["blob", "data", "about"].contains(url.scheme ?? "") || ours || action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        openOutside(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showOffline() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
}

// MARK: - alert(), confirm(), prompt() and window.open.
extension WebController: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { openOutside(url) }
        return nil
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
