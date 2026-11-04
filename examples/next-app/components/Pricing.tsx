import { PlanCard } from './PlanCard'

export function Pricing() {
  return (
    <section id="pricing">
      <h2>Ceník</h2>
      <div className="plans">
        <PlanCard name="Basic" price="0 Kč" />
        <PlanCard name="Pro" price="290 Kč" badge="Nejoblíbenější" />
        <PlanCard name="Team" price="990 Kč" />
      </div>
    </section>
  )
}
