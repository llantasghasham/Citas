'use client';

import { useFormStatus } from 'react-dom';

/**
 * Un botón de envío que DICE que está trabajando.
 *
 * Es el primer componente de cliente de este proyecto, y conviene decir por qué
 * se hace la excepción y por qué no la rompe.
 *
 * EL PROBLEMA ERA REAL. «Enviar un correo de prueba» abre una conexión con un
 * servidor de fuera; puede tardar un segundo o puede tardar veinte —ese es el
 * tope que tiene puesto el SMTP—. Durante ese rato la pantalla no cambiaba
 * NADA, así que no había forma de distinguir «está trabajando» de «no se
 * enteró del clic». Quien no lo sabe vuelve a pulsar, y el segundo clic choca
 * contra el freno de un minuto y contesta «espere un minuto entre pruebas», que
 * desde fuera se lee como que el botón está roto.
 *
 * NO ROMPE LA REGLA de «sin JavaScript de cliente», porque no se apoya nada en
 * él: sin JavaScript esto es un `<button type="submit">` y el formulario se
 * envía igual que hasta hoy. Lo que añade el navegador cuando puede es
 * AVISAR — el estado sale de `useFormStatus`, que lee el formulario de arriba.
 * Si algo falla al cargarlo, se pierde el aviso, no la función.
 *
 * Y de paso arregla el doble clic: mientras está en curso, el botón no se puede
 * volver a pulsar. Eso no sustituye al freno del servidor —un botón desactivado
 * no es un permiso, igual que uno escondido— sino que evita gastarlo por error.
 */
export function SubmitBusy({
  idle,
  busy,
  className,
  busyClassName,
}: {
  /** Lo que dice cuando no pasa nada. */
  idle: string;
  /** Lo que dice mientras trabaja. Una frase, no «cargando». */
  busy: string;
  className: string;
  busyClassName: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      // Para quien no ve el color: un lector de pantalla anuncia que está
      // ocupado, que es la mitad del aviso que se está dando.
      aria-busy={pending}
      className={pending ? busyClassName : className}
    >
      {pending ? busy : idle}
    </button>
  );
}
