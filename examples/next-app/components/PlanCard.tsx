type Props = { name: string; price: string; badge?: string }

export function PlanCard({ name, price, badge }: Props) {
  return (
    <div className="plan">
      {badge && <span className="badge">{badge}</span>}
      <h3>{name}</h3>
      <b>{price}</b>
    </div>
  )
}
