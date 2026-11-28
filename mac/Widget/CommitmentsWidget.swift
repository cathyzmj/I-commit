import SwiftUI
import WidgetKit

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, snapshot: context.isPreview ? .sample : SnapshotStore.load() ?? .sample))
    }

    // The app reloads the widget whenever your data changes; this just keeps "today" right
    // (re-check every 30 minutes and just after midnight).
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let now = Date()
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400)).addingTimeInterval(60)
        let next = min(now.addingTimeInterval(30 * 60), midnight)
        completion(Timeline(entries: [Entry(date: now, snapshot: SnapshotStore.load())], policy: .after(next)))
    }
}

@main
struct CommitmentsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CommitmentsWidget", provider: Provider()) { entry in
            CommitmentsWidgetView(entry: entry)
        }
        .configurationDisplayName("I Commit!")
        .description("Today's progress and what's left. Opens the app.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct CommitmentsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        content
            .widgetURL(URL(string: "commitments://today"))
            .containerBackground(for: .widget) { Color.widgetPaper }
    }

    @ViewBuilder private var content: some View {
        if let snapshot = entry.snapshot {
            let model = TodayModel(snapshot, now: entry.date)
            if model.newWeek {
                Message(title: "New week 🎉", text: "Open I Commit! to start this week.")
            } else {
                switch family {
                case .systemSmall: SmallView(m: model)
                case .systemLarge, .systemExtraLarge: LargeView(m: model)
                default: MediumView(m: model)
                }
            }
        } else {
            Message(title: "I Commit!", text: "Open the I Commit! app once to set up this widget.")
        }
    }
}

// MARK: - Pieces

private struct Message: View {
    let title: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(text).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Bar: View {
    let fraction: Double
    var height: CGFloat = 6
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                Capsule().fill(Color.commitAccent)
                    .frame(width: max(fraction > 0 ? height : 0, g.size.width * min(1, max(0, fraction))))
            }
        }
        .frame(height: height)
    }
}

private struct Summary: View {
    let m: TodayModel
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .lastTextBaseline, spacing: 0) {
                Text("\(m.day.done)").font(.system(size: 30, weight: .bold)).monospacedDigit()
                Text("/\(m.day.total)").font(.system(size: 16, weight: .bold)).foregroundStyle(.secondary)
            }
            Text("done today").font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text("\(m.day.actual.hours) of \(m.day.planned.hours)").font(.caption.bold()).monospacedDigit()
            Bar(fraction: m.day.planned > 0 ? m.day.actual / m.day.planned : 0)
            Text("Week \(m.stats.pct)% · \(m.stats.actual.hours)/\(m.stats.planned.hours)")
                .font(.system(size: 10)).foregroundStyle(.secondary).padding(.top, 2)
        }
    }
}

private struct Row: View {
    let item: TodayModel.Item
    var size: CGFloat = 12
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(item.done ? Color.commitAccent : .secondary)
                .font(.system(size: size + 1))
            Text(item.name).font(.system(size: size)).lineLimit(1)
                .foregroundStyle(item.done ? .secondary : .primary)
            Spacer(minLength: 2)
            if !item.label.isEmpty {
                Text(item.label).font(.system(size: size - 1)).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }
}

private struct Updated: View {
    let date: Date?
    var body: some View {
        if let date {
            Text("Updated \(date, style: .time)").font(.system(size: 9)).foregroundStyle(.tertiary)
        }
    }
}

// MARK: - Sizes

private struct SmallView: View {
    let m: TodayModel
    var body: some View {
        VStack(alignment: .leading) {
            Summary(m: m)
            Spacer(minLength: 0)
            Updated(date: m.updatedAt)
        }
    }
}

private struct MediumView: View {
    let m: TodayModel
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading) {
                Summary(m: m)
                Spacer(minLength: 0)
                Updated(date: m.updatedAt)
            }
            .frame(width: 120)
            VStack(alignment: .leading, spacing: 4) {
                if m.items.isEmpty {
                    Text("Nothing planned today").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(m.items.prefix(6)) { Row(item: $0) }
                if m.items.count > 6 {
                    Text("+\(m.items.count - 6) more").font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct LargeView: View {
    let m: TodayModel
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Summary(m: m).frame(width: 170, alignment: .leading)
                Spacer()
                Updated(date: m.updatedAt)
            }
            Text("TODAY").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 5) {
                ForEach(m.items.prefix(9)) { Row(item: $0, size: 13) }
                if m.items.count > 9 {
                    Text("+\(m.items.count - 9) more").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            if !m.goals.isEmpty {
                Text("THIS WEEK").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary).padding(.top, 4)
                ForEach(Array(m.goals.prefix(3).enumerated()), id: \.offset) { _, g in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(g.n).font(.system(size: 12)).lineLimit(1)
                            Spacer()
                            if g.k == "c" {
                                Text("\(g.c.clean)/\(g.tg.clean)\(g.u == "h" ? "h" : "")")
                                    .font(.system(size: 11)).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                        if g.k == "c" { Bar(fraction: g.tg > 0 ? g.c / g.tg : 0, height: 4) }
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}
