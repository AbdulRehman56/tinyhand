#!/usr/bin/env python3
"""Load the local experiment in an isolated, headless GNOME Shell, never the live bus.

Build first with linux/scripts/package.sh --extension-only, then run this script.
Logs and private test configuration are kept under /tmp/opencode for diagnosis.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import zipfile

UUID = "tinyhand@abdulrehmankhan56"


def inner(root, windowed=False):
    # Only reachable through a newly created dbus-run-session.
    assert os.environ.get("TINYHAND_ISOLATED_SHELL_TEST") == str(root)
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", f"['{UUID}']"], check=True)
    subprocess.run(["gsettings", "set", "org.gnome.shell", "disable-user-extensions", "false"], check=True)
    log_path = root / "shell.log"
    with log_path.open("w") as log:
        command = ["gnome-shell", "--wayland", "--no-x11", "--wayland-display", "tinyhand-experiment"]
        command += ["--devkit"] if windowed else ["--headless", "--virtual-monitor", "1280x720"]
        shell = subprocess.Popen(command, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 30
            last = "Shell did not export its extension service"
            while time.monotonic() < deadline:
                if shell.poll() is not None:
                    raise RuntimeError(f"Isolated Shell exited with {shell.returncode}")
                result = subprocess.run(["gnome-extensions", "info", UUID],
                    text=True, capture_output=True, timeout=4)
                last = result.stdout or result.stderr
                if re.search(r"State: (?:ACTIVE|ENABLED)\b", last):
                    if windowed:
                        print("TinyHand is ACTIVE in the separate GNOME test window.", flush=True)
                        print("Move the pointer INSIDE that window. Use the toolbar gear for settings.", flush=True)
                        print("Point passes clicks through; switch to Draw for ink. Hold Alt to interact.", flush=True)
                        print("Close the test window or press Ctrl+C here to stop. Your main desktop is unchanged.", flush=True)
                        result = shell.wait()
                        if result:
                            raise RuntimeError(f"Windowed Shell exited with {result}; see {log_path}")
                        return
                    # Give real timers and Cairo callbacks time to run, not just enable().
                    time.sleep(2)
                    config_path = root / "config/tinyhand/config.json"
                    config = json.loads(config_path.read_text())
                    # Exercise the real directory monitor, toolbar rebuild and resize paths.
                    for toolbar in [{"collapsed": True}, {"collapsed": False,
                            "pinnedStyles": ["mint", "cookie"], "position": {"x": 0, "y": 0}}]:
                        config["toolbar"] = toolbar
                        temporary = config_path.with_suffix(".tmp")
                        temporary.write_text(json.dumps(config))
                        temporary.replace(config_path)
                        time.sleep(0.5)
                    subprocess.run(["gnome-extensions", "disable", UUID], check=True)
                    disabled = subprocess.run(["gnome-extensions", "info", UUID],
                        text=True, capture_output=True, check=True).stdout
                    if not re.search(r"State: (?:INACTIVE|DISABLED)\b", disabled):
                        raise RuntimeError(f"Disable did not finish: {disabled}")
                    subprocess.run(["gnome-extensions", "enable", UUID], check=True)
                    time.sleep(1)
                    active = subprocess.run(["gnome-extensions", "info", UUID],
                        text=True, capture_output=True, check=True).stdout
                    if not re.search(r"State: (?:ACTIVE|ENABLED)\b", active):
                        raise RuntimeError(f"Re-enable failed: {active}")
                    text = log_path.read_text()
                    if "TinyHand:" in text or (UUID in text and "JS ERROR" in text):
                        raise RuntimeError("Extension loaded but its real runtime callbacks failed")
                    print("PASS: real isolated GNOME Shell: ACTIVE, atomic config reload, toolbar rebuild/collapse, disable and re-enable.")
                    print(active.strip())
                    return
                if re.search(r"State: ERROR\b", last):
                    raise RuntimeError(f"Extension entered ERROR state: {last}")
                time.sleep(0.25)
            raise RuntimeError(f"Timed out waiting for ACTIVE: {last}")
        finally:
            shell.terminate()
            try:
                shell.wait(timeout=10)
            except subprocess.TimeoutExpired:
                shell.kill()
                shell.wait()


def main():
    windowed = "--windowed" in sys.argv
    args = [arg for arg in sys.argv[1:] if arg != "--windowed"]
    if len(args) == 2 and args[0] == "--inner":
        inner(Path(args[1]), windowed)
        return
    root = Path(tempfile.mkdtemp(prefix="tinyhand-shell.", dir="/tmp/opencode"))
    archive = Path(args[0]) if args else Path(__file__).resolve().parents[1] / "dist/tinyhand-local-experiment.shell-extension.zip"
    extension = root / "data/gnome-shell/extensions" / UUID
    extension.mkdir(parents=True)
    with zipfile.ZipFile(archive) as bundle:
        metadata = json.loads(bundle.read("metadata.json"))
        if "Local Experiment" not in metadata.get("version-name", ""):
            raise RuntimeError("Refusing to test an archive not marked Local Experiment")
        for name in bundle.namelist():
            if not (extension / name).resolve().is_relative_to(extension.resolve()):
                raise RuntimeError("Unsafe archive path")
        bundle.extractall(extension)
    subprocess.run(["glib-compile-schemas", "--strict", str(extension / "schemas")], check=True)
    for directory in ["home", "config/tinyhand", "cache", "runtime"]:
        (root / directory).mkdir(parents=True, mode=0o700, exist_ok=True)
    (root / "config/tinyhand/config.json").write_text(json.dumps({
        "enabled": True, "pointer": {"style": "lavender"}, "sound": {"hand": False},
        "presentation": {"enabled": not windowed, "spotlight": not windowed},
        "accessibility": {"largeControls": True, "highContrast": True},
    }))
    env = {**os.environ, "HOME": str(root / "home"), "XDG_CONFIG_HOME": str(root / "config"),
           "XDG_DATA_HOME": str(root / "data"), "XDG_CACHE_HOME": str(root / "cache"),
           "XDG_RUNTIME_DIR": str(root / "runtime"), "GSETTINGS_BACKEND": "keyfile",
           "TINYHAND_ISOLATED_SHELL_TEST": str(root), "NO_AT_BRIDGE": "1", "LC_ALL": "C"}
    # Prevent accidental inheritance of the live desktop's bus/display/activation sockets.
    for key in ["DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE",
                "WAYLAND_DISPLAY", "DISPLAY", "GSETTINGS_SCHEMA_DIR"]:
        env.pop(key, None)
    if windowed:
        # Connect only the devkit frontend to the parent display, using an absolute
        # Wayland socket path because the test has a private runtime directory.
        if os.environ.get("WAYLAND_DISPLAY"):
            display = Path(os.environ["WAYLAND_DISPLAY"])
            if not display.is_absolute():
                display = Path(os.environ["XDG_RUNTIME_DIR"]) / display
            env["WAYLAND_DISPLAY"] = str(display)
        elif os.environ.get("DISPLAY"):
            env["DISPLAY"] = os.environ["DISPLAY"]
            env["XAUTHORITY"] = os.environ.get("XAUTHORITY", str(Path.home() / ".Xauthority"))
        else:
            raise RuntimeError("Windowed preview needs a graphical Wayland or X11 session")
    print(f"Isolated Shell test directory: {root}", flush=True)
    command = ["dbus-run-session", "--", sys.executable, __file__, "--inner", str(root)]
    if windowed:
        command.append("--windowed")
    try:
        result = subprocess.run(command, env=env, timeout=None if windowed else 55)
    except KeyboardInterrupt:
        return
    if result.returncode:
        print((root / "shell.log").read_text() if (root / "shell.log").exists() else "No Shell log")
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
