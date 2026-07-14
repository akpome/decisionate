import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  const user = await currentUser()

  if (!user) {
    redirect("/sign-in")
  }

  const fullName =
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()

  return (
    <SettingsClient
      userId={user.id}
      fullName={fullName}
      emailAddress={
        user.emailAddresses[0]?.emailAddress ?? ""
      }
    />
  )
}
