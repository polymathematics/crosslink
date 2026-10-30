// Crosslink Composer: a native Mac window around the composer UI (composer/web).
// The web side edits puzzles; this side does what a page can't: read and write the repo's
// drafts and puzzles, fetch link previews without CORS limits, and commit + push to publish.
import AppKit
@preconcurrency import WebKit

// MARK: - The crosslink repo on disk

final class Repo {
    let root: URL
    init(root: URL) { self.root = root }

    var drafts: URL { root.appendingPathComponent("drafts", isDirectory: true) }
    var puzzles: URL { root.appendingPathComponent("docs/puzzles", isDirectory: true) }
    var index: URL { puzzles.appendingPathComponent("index.json") }

    static func looksValid(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.appendingPathComponent("docs/core.js").path)
    }

    // Puzzle ids are dates. Checking the shape also keeps file names inside the repo.
    static func isValidId(_ id: String) -> Bool {
        id.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    // Where the site lives: a CNAME in docs/ wins, otherwise GitHub Pages for the origin remote.
    func siteURL() -> String {
        let cname = root.appendingPathComponent("docs/CNAME")
        if let host = try? String(contentsOf: cname, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty {
            return "https://\(host)/"
        }
        let remote = Git.run(["remote", "get-url", "origin"], in: root).output.trimmingCharacters(in: .whitespacesAndNewlines)
        if let m = remote.range(of: #"github\.com[:/]([^/]+)/([^/.]+)"#, options: .regularExpression) {
            let parts = remote[m].split(whereSeparator: { $0 == ":" || $0 == "/" }).map(String.init)
            if parts.count >= 3 { return "https://\(parts[1].lowercased()).github.io/\(parts[2])/" }
        }
        return ""
    }

    func readJSON(_ url: URL) -> Any? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    func writeText(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }
}

// MARK: - git

enum Git {
    struct Result { let status: Int32; let output: String }

    // Apps launched from Finder get a bare PATH; git's GitHub credential helper (gh) lives in Homebrew.
    static let env: [String: String] = {
        var e = ProcessInfo.processInfo.environment
        e["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        e["GIT_TERMINAL_PROMPT"] = "0"
        return e
    }()

    @discardableResult
    static func run(_ args: [String], in dir: URL) -> Result {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = args
        p.currentDirectoryURL = dir
        p.environment = env
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return Result(status: -1, output: "Couldn't run git: \(error.localizedDescription)") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return Result(status: p.terminationStatus, output: String(decoding: data, as: UTF8.self))
    }
}

// MARK: - Link previews

enum Preview {
    static func fetch(_ urlString: String, done: @escaping ([String: Any]?, String?) -> Void) {
        guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            done(nil, "That doesn't look like a web address."); return
        }
        var req = URLRequest(url: url, timeoutInterval: 12)
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        req.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        req.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { done(nil, err.localizedDescription); return }
            guard let data = data else { done(nil, "The page was empty."); return }
            let head = data.prefix(1_500_000)
            let html = String(data: head, encoding: .utf8) ?? String(decoding: head, as: UTF8.self)
            let finalURL = resp?.url ?? url
            done(parse(html, url: finalURL), nil)
        }.resume()
    }

    static func parse(_ html: String, url: URL) -> [String: Any] {
        var meta: [String: String] = [:]
        let ns = html as NSString
        let tagRe = try! NSRegularExpression(pattern: #"<meta\b[^>]*>"#, options: [.caseInsensitive])
        let attrRe = try! NSRegularExpression(pattern: #"([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')"#)
        for m in tagRe.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            let tag = ns.substring(with: m.range) as NSString
            var attrs: [String: String] = [:]
            for a in attrRe.matches(in: tag as String, range: NSRange(location: 0, length: tag.length)) {
                let name = tag.substring(with: a.range(at: 1)).lowercased()
                let r = a.range(at: 3).location != NSNotFound ? a.range(at: 3) : a.range(at: 4)
                attrs[name] = tag.substring(with: r)
            }
            if let key = (attrs["property"] ?? attrs["name"] ?? attrs["itemprop"])?.lowercased(), let content = attrs["content"], meta[key] == nil {
                meta[key] = decode(content)
            }
        }
        var titleTag = ""
        if let r = html.range(of: #"<title[^>]*>([\s\S]*?)</title>"#, options: [.regularExpression, .caseInsensitive]) {
            titleTag = decode(String(html[r]).replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression))
        }
        let host = (url.host ?? "").replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression)
        let title = meta["og:title"] ?? meta["twitter:title"] ?? titleTag
        let desc = meta["og:description"] ?? meta["twitter:description"] ?? meta["description"] ?? ""
        let site = meta["og:site_name"].map { $0.caseInsensitiveCompare(host) == .orderedSame ? host : "\(host) · \($0)" } ?? host
        return ["title": clean(title, limit: 140), "description": clean(desc, limit: 220), "siteName": site, "url": url.absoluteString]
    }

    static func clean(_ s: String, limit: Int) -> String {
        let flat = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        guard flat.count > limit else { return flat }
        let cut = String(flat.prefix(limit))
        if let dot = cut.range(of: ". ", options: .backwards), cut.distance(from: cut.startIndex, to: dot.lowerBound) > limit / 2 {
            return String(cut[..<dot.lowerBound]) + "."
        }
        return cut.replacingOccurrences(of: #"\s+\S*$"#, with: "", options: .regularExpression) + "…"
    }

    static func decode(_ s: String) -> String {
        var out = s
        let named = ["&amp;": "&", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ",
                     "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…"]
        for (k, v) in named { out = out.replacingOccurrences(of: k, with: v) }
        let numRe = try! NSRegularExpression(pattern: #"&#(x?)([0-9a-fA-F]+);"#)
        let ns = out as NSString
        var result = ""
        var last = 0
        for m in numRe.matches(in: out, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let hex = ns.substring(with: m.range(at: 1)) == "x"
            if let code = UInt32(ns.substring(with: m.range(at: 2)), radix: hex ? 16 : 10), let scalar = Unicode.Scalar(code) {
                result += String(Character(scalar))
            }
            last = m.range.location + m.range.length
        }
        result += ns.substring(from: last)
        return result
    }
}

// MARK: - Bridge (JS <-> native)

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    var repo: Repo

    init(repo: Repo) { self.repo = repo }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "The composer sent a message the app didn't understand."); return
        }
        let reply: (Any?, String?) -> Void = { value, error in DispatchQueue.main.async { replyHandler(value, error) } }
        switch cmd {
        case "list": reply(list(), nil)
        case "load": load(body, reply)
        case "save": save(body, reply)
        case "preview":
            Preview.fetch(body["url"] as? String ?? "") { value, error in reply(value, error) }
        case "open":
            if let s = body["url"] as? String, let url = URL(string: s) { NSWorkspace.shared.open(url) }
            reply(["ok": true], nil)
        case "publish":
            DispatchQueue.global(qos: .userInitiated).async { reply(self.publish(body), nil) }
        default:
            reply(nil, "Unknown command \(cmd)")
        }
    }

    private func list() -> [String: Any] {
        let fm = FileManager.default
        let files = (try? fm.contentsOfDirectory(at: repo.drafts, includingPropertiesForKeys: nil)) ?? []
        let drafts: [[String: Any]] = files.filter { $0.pathExtension == "json" }.compactMap { url in
            guard let d = repo.readJSON(url) as? [String: Any], let id = d["id"] as? String else { return nil }
            return ["id": id, "title": d["title"] ?? "", "number": d["number"] ?? 0, "date": d["date"] ?? id, "author": d["author"] ?? ""]
        }.sorted { ($0["id"] as! String) < ($1["id"] as! String) }
        let published = (repo.readJSON(repo.index) as? [[String: Any]]) ?? []
        return ["drafts": drafts, "published": published, "repo": ["path": repo.root.path, "site": repo.siteURL()]]
    }

    private func load(_ body: [String: Any], _ reply: (Any?, String?) -> Void) {
        guard let id = body["id"] as? String, Repo.isValidId(id) else { reply(nil, "That puzzle id isn't a date."); return }
        reply(repo.readJSON(repo.drafts.appendingPathComponent("\(id).json")), nil)
    }

    private func save(_ body: [String: Any], _ reply: (Any?, String?) -> Void) {
        guard let text = body["draft"] as? String,
              let d = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let id = d["id"] as? String, Repo.isValidId(id) else {
            reply(nil, "The draft needs a week-of date before it can be saved."); return
        }
        do {
            try repo.writeText(text, to: repo.drafts.appendingPathComponent("\(id).json"))
            if let prev = body["previousId"] as? String, prev != id, Repo.isValidId(prev) {
                try? FileManager.default.removeItem(at: repo.drafts.appendingPathComponent("\(prev).json"))
            }
            reply(["ok": true], nil)
        } catch {
            reply(nil, error.localizedDescription)
        }
    }

    // Write the puzzle and the index, then commit and push just those files.
    private func publish(_ body: [String: Any]) -> [String: Any] {
        guard let draftText = body["draft"] as? String, let pubText = body["published"] as? String,
              let pub = try? JSONSerialization.jsonObject(with: Data(pubText.utf8)) as? [String: Any],
              let id = pub["id"] as? String, Repo.isValidId(id) else {
            return ["ok": false, "error": "The puzzle needs a week-of date before it can be published."]
        }
        var log = ""
        do {
            try repo.writeText(draftText, to: repo.drafts.appendingPathComponent("\(id).json"))
            try repo.writeText(pubText, to: repo.puzzles.appendingPathComponent("\(id).json"))
            var index = (repo.readJSON(repo.index) as? [[String: Any]]) ?? []
            index.removeAll { ($0["id"] as? String) == id }
            index.append(["id": id, "number": pub["number"] ?? 0, "title": pub["title"] ?? "", "date": pub["date"] ?? id])
            index.sort { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
            let data = try JSONSerialization.data(withJSONObject: index, options: [.prettyPrinted, .sortedKeys])
            try repo.writeText(String(decoding: data, as: UTF8.self) + "\n", to: repo.index)
        } catch {
            return ["ok": false, "error": "Couldn't write the puzzle files: \(error.localizedDescription)", "log": log]
        }

        let number = String(format: "%03d", (pub["number"] as? Int) ?? 0)
        let title = (pub["title"] as? String) ?? ""
        let steps: [[String]] = [
            ["add", "docs/puzzles/\(id).json", "docs/puzzles/index.json"],
            ["commit", "-m", "Publish crosslink No. \(number): \(title)", "--", "docs/puzzles/\(id).json", "docs/puzzles/index.json"],
            ["pull", "--rebase", "--autostash"],
            ["push"],
        ]
        for args in steps {
            let r = Git.run(args, in: repo.root)
            log += "$ git \(args.joined(separator: " "))\n\(r.output)\n"
            // republishing an unchanged puzzle has nothing to commit; still push in case an earlier push failed
            if r.status != 0 && !(args[0] == "commit" && r.output.contains("nothing")) {
                return ["ok": false, "error": "git \(args[0]) failed. The puzzle is saved locally; fix the problem below and publish again.", "log": log]
            }
        }
        return ["ok": true, "log": log, "url": repo.siteURL() + "#" + id]
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var bridge: Bridge!

    func applicationDidFinishLaunching(_ note: Notification) {
        guard let root = findRepo() else { NSApp.terminate(nil); return }
        bridge = Bridge(repo: Repo(root: root))
        buildMenu()

        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "composer")
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Crosslink Composer"
        window.minSize = NSSize(width: 980, height: 640)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("ComposerWindow")
        window.makeKeyAndOrderFront(nil)

        let web = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        webView.loadFileURL(web.appendingPathComponent("composer.html"), allowingReadAccessTo: web)
        NSApp.activate(ignoringOtherApps: true)
    }

    // The repo path is baked in at build time; if it has moved, ask once and remember.
    func findRepo() -> URL? {
        let fm = FileManager.default
        if let saved = UserDefaults.standard.string(forKey: "repoPath"), Repo.looksValid(URL(fileURLWithPath: saved)) {
            return URL(fileURLWithPath: saved)
        }
        if let baked = Bundle.main.object(forInfoDictionaryKey: "CrosslinkRepo") as? String, fm.fileExists(atPath: baked), Repo.looksValid(URL(fileURLWithPath: baked)) {
            return URL(fileURLWithPath: baked)
        }
        let panel = NSOpenPanel()
        panel.message = "Choose your crosslink folder (the one with docs/ and drafts/ inside)."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Use This Folder"
        while panel.runModal() == .OK, let url = panel.url {
            if Repo.looksValid(url) { UserDefaults.standard.set(url.path, forKey: "repoPath"); return url }
            let a = NSAlert()
            a.messageText = "That folder doesn't look like crosslink."
            a.informativeText = "Pick the folder that contains docs/core.js."
            a.runModal()
        }
        return nil
    }

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ key: String, _ mods: NSEvent.ModifierFlags = .command, _ sel: Selector?) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            return i
        }
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(item("About Crosslink Composer", "", [], #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        app.addItem(.separator())
        app.addItem(item("Hide Crosslink Composer", "h", .command, #selector(NSApplication.hide(_:))))
        app.addItem(item("Quit Crosslink Composer", "q", .command, #selector(NSApplication.terminate(_:))))
        appItem.submenu = app

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let file = NSMenu(title: "File")
        for (title, key, mods, cmd) in [("New Puzzle", "n", NSEvent.ModifierFlags.command, "new"), ("Open…", "o", .command, "open"),
                                        ("Save", "s", .command, "save"), ("Test Solve", "t", .command, "test"),
                                        ("Publish…", "p", [.command, .shift], "publish")] {
            let i = item(title, key, mods, #selector(runCommand(_:)))
            i.representedObject = cmd
            i.target = self
            if cmd == "test" { file.addItem(.separator()) }
            file.addItem(i)
        }
        file.addItem(.separator())
        let reveal = item("Show Drafts in Finder", "", [], #selector(revealDrafts))
        reveal.target = self
        file.addItem(reveal)
        file.addItem(item("Close Window", "w", .command, #selector(NSWindow.performClose(_:))))
        fileItem.submenu = file

        // text fields in the web view need these to get copy/paste/undo
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", "z", .command, Selector(("undo:"))))
        edit.addItem(item("Redo", "z", [.command, .shift], Selector(("redo:"))))
        edit.addItem(.separator())
        edit.addItem(item("Cut", "x", .command, #selector(NSText.cut(_:))))
        edit.addItem(item("Copy", "c", .command, #selector(NSText.copy(_:))))
        edit.addItem(item("Paste", "v", .command, #selector(NSText.paste(_:))))
        edit.addItem(item("Select All", "a", .command, #selector(NSText.selectAll(_:))))
        editItem.submenu = edit

        let windowItem = NSMenuItem(); main.addItem(windowItem)
        let win = NSMenu(title: "Window")
        win.addItem(item("Minimize", "m", .command, #selector(NSWindow.performMiniaturize(_:))))
        win.addItem(item("Zoom", "", [], #selector(NSWindow.performZoom(_:))))
        windowItem.submenu = win
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc func runCommand(_ sender: NSMenuItem) {
        guard let cmd = sender.representedObject as? String else { return }
        webView.evaluateJavaScript("window.composer && window.composer.command('\(cmd)')", completionHandler: nil)
    }

    @objc func revealDrafts() {
        try? FileManager.default.createDirectory(at: bridge.repo.drafts, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([bridge.repo.drafts])
    }

    // Finish any pending autosave before quitting.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let webView = webView else { return .terminateNow }
        webView.callAsyncJavaScript("if (window.composer) { await window.composer.flush(); }", arguments: [:], in: nil, in: .page) { _ in
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Links in the composer (and in Test Solve) open in the default browser, never inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""), action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
