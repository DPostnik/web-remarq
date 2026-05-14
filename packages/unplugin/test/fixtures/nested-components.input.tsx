function Header() {
  return <h1>Title</h1>;
}

function Footer() {
  return <footer>Bottom</footer>;
}

export default function Page() {
  return (
    <article>
      <Header />
      <p>Body</p>
      <Footer />
    </article>
  );
}
