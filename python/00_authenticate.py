"""One-time GEE authentication helper.

Run this script ONCE per machine to register your credentials. After that
the other scripts can just `ee.Initialize(project=...)`.

Usage:
    python 00_authenticate.py --project YOUR_GCP_PROJECT_ID

If you don't have a GCP project yet:
    1. Visit https://console.cloud.google.com/ and create one (free tier).
    2. Register it at https://code.earthengine.google.com/register
"""
from __future__ import annotations

import argparse
import sys

import ee


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project",
        required=True,
        help="Google Cloud project ID with Earth Engine API enabled",
    )
    args = parser.parse_args()

    print("Step 1: Browser auth flow ...")
    ee.Authenticate()

    print("Step 2: Initialize ee with your project ...")
    ee.Initialize(project=args.project)

    print("Step 3: Smoke test ...")
    n = ee.Number(42).add(8).getInfo()
    assert n == 50, "Math is broken; GEE init likely failed."

    print("\n✔ GEE authentication complete.")
    print(f"  Project: {args.project}")
    print(f"  Credentials cached at ~/.config/earthengine/credentials\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n✘ Authentication failed: {e}")
        sys.exit(1)
