import "./globals.css"
import { ClerkProvider, UserButton } from "@clerk/nextjs"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <div className="min-h-screen">
            <header className="flex justify-end border-b bg-white px-6 py-4">
              <UserButton />
            </header>

            {children}
          </div>
        </body>
      </html>
    </ClerkProvider>
  )
}