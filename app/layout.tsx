import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
export const metadata: Metadata = {
  metadataBase: new URL('https://orbit.havlli.dev'),
  alternates: { canonical: 'https://orbit.havlli.dev' },
  icons: { icon: '/favicon.svg' },
  title: 'ORBIT | Solar atlas and space missions',
  description:
    'Explore an illustrated 3D solar atlas and follow spacecraft through selected encounters from 1957 to 2021.',
  openGraph: {
    url: 'https://orbit.havlli.dev',
    title: 'ORBIT | Solar atlas and space missions',
    description:
      'Explore an illustrated 3D solar atlas and follow spacecraft through selected encounters from 1957 to 2021.',
    type: 'website',
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
