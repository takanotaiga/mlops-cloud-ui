import Provider from "./provider"
import Header from "@/components/header"
import { cookies } from "next/headers"

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const cookieLang = cookieStore.get('mlops-ui.lang')?.value
  const initialLang = (cookieLang === 'ja' || cookieLang === 'en') ? (cookieLang as 'ja'|'en') : 'en'
  return (
    <html lang={initialLang} suppressHydrationWarning>
      <body>
        <Provider initialLang={initialLang}>
          <Header />
          {children}
        </Provider>
      </body>
    </html>
  )
}
