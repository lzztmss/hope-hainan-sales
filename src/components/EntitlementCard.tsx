type Entitlement = {
  label: string;
  display: string;
};

type EntitlementCardProps = {
  entitlements: readonly Entitlement[];
};

export const EntitlementCard = ({
  entitlements,
}: EntitlementCardProps) => (
  <section aria-labelledby="entitlement-title" className="entitlement-card">
    <h2 id="entitlement-title">专属权益</h2>
    <div>
      {entitlements.map((entitlement) => (
        <article key={entitlement.label}>
          <h3>{entitlement.label}</h3>
          <p>{entitlement.display}</p>
        </article>
      ))}
    </div>
  </section>
);
