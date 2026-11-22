"""Manage the existing Meta reviewer's Clerk Device Trust exception, outside the sign-in flow."""

import argparse
import os
import re
import sys

import httpx


REVIEWER = "meta_reviewer@decisionate.ca"


def verified_reviewer(user):
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        return False
    if not re.fullmatch(r"user_[A-Za-z0-9]+", user["id"]) or not isinstance(user.get("email_addresses"), list):
        return False
    primary = user.get("primary_email_address_id")
    return bool(primary) and any(
        isinstance(address, dict)
        and address.get("id") == primary
        and isinstance(address.get("email_address"), str)
        and address["email_address"].casefold() == REVIEWER
        and isinstance(address.get("verification"), dict)
        and address["verification"].get("status") == "verified"
        for address in user["email_addresses"]
    )


def configure(client, action):
    users = client.get("/v1/users", params={"email_address": REVIEWER, "limit": 2}).raise_for_status().json()
    if not isinstance(users, list) or len(users) != 1 or not verified_reviewer(users[0]):
        raise ValueError("Expected one existing Clerk user with the reviewer's verified primary email. No change made.")
    user = users[0]
    current = user.get("bypass_client_trust")
    if not isinstance(current, bool):
        raise ValueError("Clerk did not report the Device Trust setting. No change made.")
    if action == "status":
        return current
    if action not in {"enable", "restore"}:
        raise ValueError("Unknown action.")
    enable = action == "enable"
    if enable:
        if len(user["email_addresses"]) != 1:
            raise ValueError("Use a dedicated reviewer account with no other email addresses. No change made.")
        if user.get("password_enabled") is not True or user.get("two_factor_enabled") is not False:
            raise ValueError("The reviewer needs password sign-in without enrolled MFA. No sign-in method was changed.")
    if current is enable:
        return current
    path = "/v1/users/" + user["id"]
    client.patch(path, json={"bypass_client_trust": enable}).raise_for_status()
    updated = client.get(path).raise_for_status().json()
    if not verified_reviewer(updated) or updated["id"] != user["id"] or updated.get("bypass_client_trust") is not enable:
        raise ValueError("The update was submitted, but its result could not be verified. Check the Clerk user before retrying.")
    return enable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "enable", "restore"], nargs="?", default="status",
                        help="enable the exception, restore standard checks, or read status (default)")
    args = parser.parse_args()
    key = os.getenv("CLERK_SECRET_KEY", "").strip()
    if not key.startswith("sk_live_"):
        parser.exit(1, "Run this command in the Decisionate production API environment with its Clerk secret key.\n")
    try:
        with httpx.Client(base_url="https://api.clerk.com", headers={"Authorization": f"Bearer {key}",
                         "Clerk-API-Version": "2025-11-10"}, timeout=10, follow_redirects=False) as client:
            exempt = configure(client, args.action)
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"Clerk returned HTTP {exc.response.status_code}. The setting was not confirmed.\n")
    except httpx.RequestError:
        parser.exit(1, "Clerk could not be reached. Use status to check before retrying.\n")
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    print(f"{REVIEWER}: Device Trust exception {'enabled' if exempt else 'off'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
