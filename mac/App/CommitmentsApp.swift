import SwiftUI

@main
struct CommitmentsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var web = WebController()

    var body: some Scene {
        Window("I Commit!", id: "main") {
            WebContainer(controller: web)
                .frame(minWidth: 420, minHeight: 560)
                .onOpenURL { web.open($0) } // commitments://today etc. (from the widget)
        }
        .defaultSize(width: 1100, height: 780)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Go") {
                Button("Overview") { web.go("home") }.keyboardShortcut("0")
                Button("This week") { web.go("plan") }.keyboardShortcut("1")
                Button("Calendar") { web.go("cal") }.keyboardShortcut("2")
                Button("Routine") { web.go("routine") }.keyboardShortcut("3")
                Button("Academics") { web.go("academics") }.keyboardShortcut("4")
                Button("Applications") { web.go("apps") }.keyboardShortcut("5")
                Button("Projects") { web.go("gallery") }.keyboardShortcut("6")
                Button("Our Tree") { web.go("buddy") }.keyboardShortcut("7")
                Divider()
                Button("Reload") { web.reload() }.keyboardShortcut("r")
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    // Closing the window quits the app; the widget reopens it when clicked.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

struct WebContainer: NSViewRepresentable {
    let controller: WebController
    func makeNSView(context: Context) -> NSView { controller.webView }
    func updateNSView(_ nsView: NSView, context: Context) {}
}
