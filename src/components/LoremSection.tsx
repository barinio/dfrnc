type Props = {
  visible: boolean;
};

export default function LoremSection({ visible }: Props) {
  return (
    <section
      style={{
        position: "relative",
        zIndex: 2,
        background: "transparent",
        width: "100%",
        marginTop: "-100vh",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 300ms ease-out",
      }}
    >
      <div
        style={{
          maxWidth: "680px",
          margin: "0 auto",
          padding: "6rem 2rem",
          color: "rgba(255,255,255,0.75)",
          fontFamily: "system-ui, sans-serif",
          fontSize: "1.0625rem",
          lineHeight: 1.75,
        }}
      >
        <h2
          style={{
            fontSize: "2rem",
            fontWeight: 600,
            color: "#fff",
            marginBottom: "2rem",
            letterSpacing: "-0.02em",
          }}
        >
          Lorem ipsum dolor sit amet
        </h2>
        <p style={{ marginBottom: "1.5rem" }}>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
          minim veniam, quis nostrud exercitation ullamco laboris nisi ut
          aliquip ex ea commodo consequat. Duis aute irure dolor in
          reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Excepteur sint occaecat cupidatat non proident, sunt in culpa qui
          officia deserunt mollit anim id est laborum. Pellentesque habitant
          morbi tristique senectus et netus et malesuada fames ac turpis
          egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor
          sit amet, ante.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Donec eu libero sit amet quam egestas semper. Aenean ultricies mi
          vitae est. Mauris placerat eleifend leo. Quisque sit amet est et
          sapien ullamcorper pharetra. Vestibulum erat wisi, condimentum sed,
          commodo vitae, ornare sit amet, wisi.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Aenean fermentum risus id tortor. Integer ullamcorper leo ut odio.
          Fusce lobortis lorem at ipsum semper sagittis. Vivamus ut fermentum
          leo, vel congue lectus. Ut blandit iaculis enim, non feugiat nulla
          fermentum in. Proin at ante in augue pharetra fringilla vitae a nunc.
        </p>
        <p>
          Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam
          varius, turpis molestie dictum semper, nisl nibh commodo enim, dapibus
          hendrerit eros erat non ante. Sed scelerisque consectetur est. Quisque
          elementum turpis at nisi malesuada, vitae vestibulum metus finibus.
        </p>

        <p style={{ marginBottom: "1.5rem" }}>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
          minim veniam, quis nostrud exercitation ullamco laboris nisi ut
          aliquip ex ea commodo consequat. Duis aute irure dolor in
          reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Excepteur sint occaecat cupidatat non proident, sunt in culpa qui
          officia deserunt mollit anim id est laborum. Pellentesque habitant
          morbi tristique senectus et netus et malesuada fames ac turpis
          egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor
          sit amet, ante.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Donec eu libero sit amet quam egestas semper. Aenean ultricies mi
          vitae est. Mauris placerat eleifend leo. Quisque sit amet est et
          sapien ullamcorper pharetra. Vestibulum erat wisi, condimentum sed,
          commodo vitae, ornare sit amet, wisi.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Aenean fermentum risus id tortor. Integer ullamcorper leo ut odio.
          Fusce lobortis lorem at ipsum semper sagittis. Vivamus ut fermentum
          leo, vel congue lectus. Ut blandit iaculis enim, non feugiat nulla
          fermentum in. Proin at ante in augue pharetra fringilla vitae a nunc.
        </p>
        <p>
          Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam
          varius, turpis molestie dictum semper, nisl nibh commodo enim, dapibus
          hendrerit eros erat non ante. Sed scelerisque consectetur est. Quisque
          elementum turpis at nisi malesuada, vitae vestibulum metus finibus.
        </p>

        <p style={{ marginBottom: "1.5rem" }}>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
          minim veniam, quis nostrud exercitation ullamco laboris nisi ut
          aliquip ex ea commodo consequat. Duis aute irure dolor in
          reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Excepteur sint occaecat cupidatat non proident, sunt in culpa qui
          officia deserunt mollit anim id est laborum. Pellentesque habitant
          morbi tristique senectus et netus et malesuada fames ac turpis
          egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor
          sit amet, ante.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Donec eu libero sit amet quam egestas semper. Aenean ultricies mi
          vitae est. Mauris placerat eleifend leo. Quisque sit amet est et
          sapien ullamcorper pharetra. Vestibulum erat wisi, condimentum sed,
          commodo vitae, ornare sit amet, wisi.
        </p>
        <p style={{ marginBottom: "1.5rem" }}>
          Aenean fermentum risus id tortor. Integer ullamcorper leo ut odio.
          Fusce lobortis lorem at ipsum semper sagittis. Vivamus ut fermentum
          leo, vel congue lectus. Ut blandit iaculis enim, non feugiat nulla
          fermentum in. Proin at ante in augue pharetra fringilla vitae a nunc.
        </p>
        <p>
          Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam
          varius, turpis molestie dictum semper, nisl nibh commodo enim, dapibus
          hendrerit eros erat non ante. Sed scelerisque consectetur est. Quisque
          elementum turpis at nisi malesuada, vitae vestibulum metus finibus.
        </p>
      </div>
    </section>
  );
}
