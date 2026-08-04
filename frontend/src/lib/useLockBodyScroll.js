import { useEffect } from 'react';

// Trava o scroll da página por trás enquanto um modal fullscreen está aberto.
// Sem isso, girar o mouse sobre a área escurecida do modal rola o conteúdo de
// fundo (a lista/página) mesmo com o modal cobrindo a tela.
export function useLockBodyScroll(locked) {
  useEffect(() => {
    if (!locked) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [locked]);
}
