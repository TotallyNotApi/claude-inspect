import { Pricing } from './Pricing'

export function Page() {
  return (
    <>
      <header className="nav"><span>Acme</span><span>Funkce · Ceník · Kontakt</span></header>
      <main>
        <Pricing />
      </main>
    </>
  )
}
