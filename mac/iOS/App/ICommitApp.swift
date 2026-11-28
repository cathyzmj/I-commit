import SwiftUI

@main
struct ICommitApp: App {
    @StateObject private var web = WebController()

    var body: some Scene {
        WindowGroup {
            WebContainer(controller: web)
                .ignoresSafeArea(.container, edges: [.bottom, .horizontal]) // scrolls under the home bar, not the clock
                .ignoresSafeArea(.keyboard) // the page moves its own fields above the keyboard
                .background(Color(red: 0.863, green: 0.937, blue: 0.914).ignoresSafeArea()) // the app's theme colour
                .onOpenURL { web.open($0) } // commitments://today etc. (from the widget)
        }
    }
}

struct WebContainer: UIViewRepresentable {
    let controller: WebController
    func makeUIView(context: Context) -> UIView { controller.webView }
    func updateUIView(_ view: UIView, context: Context) {}
}
