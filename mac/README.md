# Commitments for Mac

A native Mac app around the web app plus a desktop widget.

- **App** (`App/`): a window showing the web app. Exports open a Save panel, restore opens a file picker,
  outside links (Notion, course sites…) open in their own apps. ⌘1–⌘5 switch pages, ⌘R reloads.
- **Widget** (`Widget/`): small / medium / large desktop widget with today's progress and what's left.
  Clicking it opens the app on Today. The app hands the widget its data through a shared app-group
  file whenever your data changes (no network, no key).
- **Shared** (`Shared/`): the widget summary model, used by both.

## Build
1. Xcode → Settings → Accounts → **+** → sign in with your Apple ID (a free Personal Team works).
2. Copy `Local.example.xcconfig` to `Local.xcconfig` and fill in your team ID, bundle ID prefix and web app host.
3. `cd mac && xcodegen` (install with `brew install xcodegen`), then open `Commitments.xcodeproj`.
4. Product → Run, or build from the terminal:
   `xcodebuild -scheme Commitments -configuration Release -derivedDataPath build -allowProvisioningUpdates build`
   and copy `build/Build/Products/Release/Commitments.app` to /Applications.

With a free Personal Team the signature lasts about a year; rebuild when it expires.

## iPhone

The same project has an iPhone app (`ICommit`) and its home-screen widget (`ICommitWidget`). It shows the
web app at `APP_HOST`, keeps an offline copy, opens Google sign-in in a Safari sheet, and feeds the widget.

- Simulator: `cd mac && xcodegen`, then run the `ICommit` scheme on an iPhone simulator.
- To try a copy running on this Mac, add the launch argument `-home http://localhost:8766/` (debug builds only).
- A real phone or TestFlight needs the team ID of a paid Apple Developer account in `Local.xcconfig`.

Not built yet: the app's own notifications.
