#!/usr/bin/env python3
"""
NFC Wristband Programming Script
Programs NTAG213 disc tokens with unique URLs using an ACR122U reader.

Usage:
    pip install nfcpy
    python program_wristbands.py --count 130 --base-url https://yourdomain.up.railway.app --start 1
"""

import argparse
import csv
import os
import sys
import time
from datetime import datetime

try:
    import nfc
    import ndef
except ImportError:
    print("Error: nfcpy not installed. Run: pip install nfcpy")
    sys.exit(1)


def program_tag(clf, url):
    """Wait for a tag and write the NDEF URL record."""
    tag = clf.connect(rdwr={'on-connect': lambda tag: False})
    if not tag:
        raise RuntimeError("No tag detected")

    record = ndef.UriRecord(url)
    message = ndef.message_encoder([record])
    raw = b''.join(message)

    if tag.ndef is None:
        raise RuntimeError("Tag does not support NDEF")

    tag.ndef.records = [ndef.UriRecord(url)]
    return True


def main():
    parser = argparse.ArgumentParser(description="Program NFC wristbands with unique URLs")
    parser.add_argument("--count", type=int, default=130, help="Total number of wristbands to program")
    parser.add_argument("--base-url", required=True, help="Base URL (e.g. https://yourdomain.up.railway.app)")
    parser.add_argument("--start", type=int, default=1, help="Starting wristband number")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    log_file = "wristband_log.csv"
    file_exists = os.path.exists(log_file)

    programmed = 0
    current = args.start

    # Open NFC reader
    try:
        clf = nfc.ContactlessFrontend("usb")
    except Exception as e:
        print(f"Error opening NFC reader: {e}")
        print("Make sure the ACR122U is connected and drivers are installed.")
        sys.exit(1)

    print(f"NFC reader ready. Programming wristbands {args.start:03d} to {args.count:03d}.")
    print(f"Base URL: {base_url}")
    print(f"Log file: {log_file}")
    print("Press Ctrl+C to stop.\n")

    try:
        with open(log_file, "a", newline="") as csvfile:
            writer = csv.writer(csvfile)
            if not file_exists:
                writer.writerow(["wristband_id", "url", "programmed_at"])

            while current <= args.count:
                wristband_id = f"{current:03d}"
                url = f"{base_url}/tap/{wristband_id}"

                print(f"Place wristband {wristband_id} on the reader...")

                try:
                    program_tag(clf, url)
                    timestamp = datetime.now().isoformat()
                    writer.writerow([wristband_id, url, timestamp])
                    csvfile.flush()
                    programmed += 1
                    print(f"✓ Wristband {wristband_id} programmed — {url}")
                    current += 1
                    time.sleep(1)
                except Exception as e:
                    print(f"✗ Error programming {wristband_id}: {e}")
                    print("  Skipping — try this one again later.")
                    # Do not increment current on error — retry same wristband
                    time.sleep(1)

    except KeyboardInterrupt:
        print(f"\n\nStopped by user.")
        print(f"Programmed {programmed} wristbands.")
        print(f"To resume, run with --start {current}")
    finally:
        clf.close()
        print(f"\nTotal programmed this session: {programmed}")


if __name__ == "__main__":
    main()
