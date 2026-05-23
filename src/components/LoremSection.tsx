import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  visible: boolean;
};

// Length of the invisible scroll buffer applied right after the animation
// finishes and the text appears. During this distance the section is pinned at
// the top of the viewport so the heading has time to settle before the page
// starts scrolling the text away.
const BUFFER_VH = 50;

export default function LoremSection({ visible }: Props) {
  const sectionRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: () => "+=" + window.innerHeight * (BUFFER_VH / 100),
        pin: true,
        pinSpacing: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      });
    });
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        zIndex: 2,
        background: "transparent",
        width: "100%",
        marginTop: "-100vh",
        opacity: visible ? 1 : 0,
        filter: visible ? "blur(0px)" : "blur(24px)",
        pointerEvents: visible ? "auto" : "none",
        transition:
          "opacity 900ms cubic-bezier(0.22, 1, 0.36, 1), filter 900ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "opacity, filter",
      }}
    >
      <div
        style={{
          maxWidth: "680px",
          margin: "0 auto",
          padding: "2rem",
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
