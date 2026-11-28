import Foundation
import SwiftUI
#if canImport(AppKit)
import AppKit
#else
import UIKit
#endif

/// The summary the web app produces for widgets (see widgetSnapshot() in app.js).
struct Snapshot: Codable {
    struct Day: Codable { var done: Int; var total: Int; var actual: Double; var planned: Double }
    struct Stats: Codable { var planned: Double; var actual: Double; var pct: Int }
    /// k: "t" task / "c" counter; d: per day (Mon…Sun) 0/1 for tasks or the count for counters.
    struct Daily: Codable { var n: String; var k: String; var tg: Double; var u: String?; var d: [Double] }
    struct Once: Codable { var n: String; var date: String; var time: String?; var endTime: String?; var done: Int }
    struct Weekly: Codable { var n: String; var k: String; var tg: Double; var u: String?; var c: Double; var done: Int }

    var v: Int
    var updatedAt: String
    var week: String
    var days: [Day]
    var stats: Stats
    var daily: [Daily]
    var once: [Once]
    var weekly: [Weekly]
}

/// Shared file in the app group container: the app writes it, the widget reads it.
enum SnapshotStore {
    static var groupID: String { Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String ?? "" }

    static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: groupID)?
            .appendingPathComponent("snapshot.json")
    }

    @discardableResult
    static func save(_ data: Data) -> Error? {
        guard let url = fileURL else { return CocoaError(.fileNoSuchFile) }
        do { try data.write(to: url, options: .atomic); return nil } catch { return error }
    }

    static func load() -> Snapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
}

/// Today's view of a snapshot, worked out the same way as the Scriptable widget.
struct TodayModel {
    struct Item: Identifiable {
        let id = UUID()
        let name: String
        let done: Bool
        let label: String
    }

    let newWeek: Bool
    let items: [Item]
    let day: Snapshot.Day
    let stats: Snapshot.Stats
    let goals: [Snapshot.Weekly]
    let updatedAt: Date?

    init(_ s: Snapshot, now: Date = .now) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let today = cal.startOfDay(for: now)
        let dayIndex = (cal.component(.weekday, from: today) + 5) % 7 // Monday = 0
        let monday = cal.date(byAdding: .day, value: -dayIndex, to: today)!
        let f = DateFormatter()
        f.calendar = cal
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        let todayISO = f.string(from: today)

        newWeek = s.week != f.string(from: monday)
        day = s.days.indices.contains(dayIndex) ? s.days[dayIndex] : Snapshot.Day(done: 0, total: 0, actual: 0, planned: 0)
        stats = s.stats
        goals = s.weekly.filter { $0.done == 0 }

        func reached(_ n: Double, _ target: Double) -> Bool { target > 0 ? n >= target : n > 0 }
        let todays = s.once.filter { $0.date == todayISO }
            .sorted { ($0.time ?? "") < ($1.time ?? "") }
            .map { Item(name: $0.n, done: $0.done == 1, label: $0.time ?? "") }
        let dailies = s.daily.map { d -> Item in
            let n = d.d.indices.contains(dayIndex) ? d.d[dayIndex] : 0
            let counter = d.k == "c"
            return Item(name: d.n,
                        done: counter ? reached(n, d.tg) : n > 0,
                        label: counter ? "\(n.clean)/\(d.tg.clean)" : "")
        }
        // Still to do first, then done; keep the app's order within each group.
        let all = todays + dailies
        items = all.filter { !$0.done } + all.filter { $0.done }
        updatedAt = ISO8601DateFormatter.withFractions.date(from: s.updatedAt) ?? ISO8601DateFormatter().date(from: s.updatedAt)
    }
}

extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

extension Double {
    /// 2 -> "2", 2.5 -> "2.5"
    var clean: String { truncatingRemainder(dividingBy: 1) == 0 ? String(Int(self)) : String(format: "%.1f", self) }
    var hours: String { "\(clean)h" }
}

extension Color {
    /// The app's green (#1d7a5f light / #3cbf94 dark).
    #if os(macOS)
    static let commitAccent = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.235, green: 0.749, blue: 0.580, alpha: 1)
            : NSColor(srgbRed: 0.114, green: 0.478, blue: 0.373, alpha: 1)
    })
    #else
    static let commitAccent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.235, green: 0.749, blue: 0.580, alpha: 1)
            : UIColor(red: 0.114, green: 0.478, blue: 0.373, alpha: 1)
    })
    #endif

    static var widgetPaper: Color {
        #if os(macOS)
        Color(nsColor: .windowBackgroundColor)
        #else
        Color(uiColor: .systemBackground)
        #endif
    }
}

extension Snapshot {
    /// Shown in the widget gallery before the app has sent anything.
    static let sample = Snapshot(
        v: 1, updatedAt: ISO8601DateFormatter().string(from: .now), week: "",
        days: Array(repeating: Day(done: 2, total: 6, actual: 1.5, planned: 5.25), count: 7),
        stats: Stats(planned: 56.75, actual: 12.5, pct: 30),
        daily: [
            Daily(n: "Practice questions", k: "t", tg: 1, u: "", d: Array(repeating: 1, count: 7)),
            Daily(n: "Outreach messages", k: "c", tg: 3, u: "messages", d: Array(repeating: 2, count: 7)),
            Daily(n: "Independent study", k: "t", tg: 1, u: "", d: Array(repeating: 0, count: 7)),
        ],
        once: [], weekly: [Weekly(n: "Side project", k: "c", tg: 15, u: "h", c: 4.5, done: 0)]
    )
}
