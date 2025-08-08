import Provider from "./provider"
import Header from "@/components/header"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>
          <Header />
          {children}
        </Provider>
      </body>
    </html>
  )
}
