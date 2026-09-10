/**
 * La cara de alguien, o su inicial cuando todavía no ha puesto ninguna.
 *
 * Un solo componente para las tres pantallas donde sale —el perfil, el equipo y
 * la cabecera— porque tres redondos dibujados en tres sitios distintos acaban
 * siendo tres tamaños distintos.
 */
export function Avatar({
  src,
  name,
  size,
}: {
  src: string | null;
  /** De dónde sale la inicial: el nombre, o el correo si no hay nombre. */
  name: string;
  /** El lado en píxeles. Se usa 96 en el perfil y 36 en las listas. */
  size: number;
}) {
  const style = { width: `${size}px`, height: `${size}px` };

  if (src === null) {
    return (
      <span
        style={{ ...style, fontSize: `${Math.round(size * 0.4)}px` }}
        className="grid shrink-0 place-items-center rounded-full bg-[#ddd6c6] text-[#6a6456]"
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- o son bytes que
    // sirve este mismo proceso, o una dirección de fuera que escribió alguien:
    // ninguna de las dos pasa por el optimizador de imágenes.
    <img
      src={src}
      alt=""
      style={style}
      className="shrink-0 rounded-full object-cover"
      width={size}
      height={size}
    />
  );
}
