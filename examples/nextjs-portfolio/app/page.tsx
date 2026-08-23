import { PortfolioChat } from "@/components/portfolio-chat";

const projects = [
  {
    name: "Northwind Analytics",
    blurb: "Warehouse metrics dashboard for a mid-market retailer.",
  },
  {
    name: "Harbor CMS",
    blurb: "Headless content toolkit for museum exhibition sites.",
  },
  {
    name: "Pulse Forms",
    blurb: "Accessible multi-step intake for clinic front desks.",
  },
];

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <p className="brand">Alex Rivera</p>
        <nav aria-label="Primary">
          <a href="#work">Work</a>
          <a href="#about">About</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <h1>Product engineer building calm interfaces for complex tools.</h1>
          <p>
            This page is a ChatAI example: a static portfolio shell with{" "}
            <code>@chatai/react</code> embedded so visitors can ask about projects.
          </p>
        </section>

        <section id="work" className="work">
          <h2>Selected work</h2>
          <ul>
            {projects.map((project) => (
              <li key={project.name}>
                <h3>{project.name}</h3>
                <p>{project.blurb}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="about" className="about">
          <h2>About</h2>
          <p>
            Based in Brooklyn. Previously shipping design systems and internal
            admin tools. Open the chat launcher to try the assistant against your
            local ChatAI instance.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <p>Example only — not a real portfolio.</p>
      </footer>

      <PortfolioChat />
    </>
  );
}
