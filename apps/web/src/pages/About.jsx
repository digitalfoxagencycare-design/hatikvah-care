import Seo from "../components/Seo.jsx";
import { AboutBlock, ClientsBlock, FaqBlock } from "../components/Sections.jsx";
import { useSite } from "../data.jsx";

export default function About() {
  const { settings } = useSite();
  return (
    <>
      <Seo title="About Us" description={settings.about} />
      <section className="page-head"><div className="wrap"><p className="eyebrow">{settings.tagline}</p><h1>About Us</h1></div></section>
      {settings.home.stats.length > 0 && <section className="stats"><div className="wrap stat-row">{settings.home.stats.map((x, i) => <div key={i}><strong>{x.value}</strong><span>{x.label}</span></div>)}</div></section>}
      <AboutBlock />
      <ClientsBlock />
      <FaqBlock />
    </>
  );
}
