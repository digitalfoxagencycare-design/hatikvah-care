import Seo from "../components/Seo.jsx";
import { ContactBlock, FaqBlock } from "../components/Sections.jsx";
import { useSite } from "../data.jsx";

export default function Contact() {
  const { settings } = useSite();
  return (
    <>
      <Seo title="Contact Us" description={`Contact HaTikvah Care: ${settings.phone} · ${settings.email} · ${settings.address}`} />
      <section className="page-head"><div className="wrap"><h1>Contact Us</h1><p className="muted">Bulk orders, branding, samples or outside India supply: we reply within one working day.</p></div></section>
      <ContactBlock />
      <FaqBlock />
    </>
  );
}
