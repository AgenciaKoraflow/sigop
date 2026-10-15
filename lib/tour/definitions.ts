import type { TourDefinition } from './types'

/**
 * Tour catalogue. To add a tour: put `data-tour="<name>"` on the elements to
 * explain, describe the steps here and register the tour in `TOURS` with the
 * route it belongs to. `useAutoStartTour` / the topbar help button do the rest.
 */

export const HOME_TOUR: TourDefinition = {
  id: 'home',
  version: 1,
  steps: [
    {
      id: 'welcome',
      title: 'Bem-vindo ao SIGOP',
      description:
        'Este tutorial rápido mostra onde ficam as principais funções. Você pode pular a qualquer momento e rever depois pelo botão de ajuda no topo da tela.',
    },
    {
      id: 'navigation',
      target: ['[data-tour="sidebar-nav"]', '[data-tour="menu-button"]'],
      title: 'Menu principal',
      description:
        'Por aqui você navega entre Início, Ocorrências, Suspeitos e as demais áreas disponíveis para o seu perfil. No celular, abra o menu por este botão.',
      placement: 'right',
    },
    {
      id: 'new-record',
      target: '[data-tour="new-record"]',
      title: 'Abrir novo registro',
      description:
        'Comece por aqui: escolha o tipo de registro (ocorrência, checagem, etc.) e preencha o formulário em poucos passos.',
      placement: 'bottom',
    },
    {
      id: 'recent-activity',
      target: '[data-tour="recent-activity"]',
      title: 'Atividade recente',
      description:
        'Acompanhe os últimos registros e abra qualquer um para ver os detalhes ou continuar de onde parou.',
      placement: 'top',
    },
    {
      id: 'profile',
      target: '[data-tour="user-profile"]',
      title: 'Seu perfil',
      description:
        'Aqui aparecem o seu nome e o seu perfil de acesso. Para encerrar a sessão, use o botão "Sair" no menu.',
      placement: 'bottom',
    },
  ],
}

interface RegisteredTour {
  /** Exact pathname the tour belongs to. */
  path: string
  tour: TourDefinition
}

const TOURS: RegisteredTour[] = [{ path: '/', tour: HOME_TOUR }]

/** The tour that explains the screen at `pathname`, if there is one. */
export function getTourForPath(pathname: string): TourDefinition | null {
  return TOURS.find((entry) => entry.path === pathname)?.tour ?? null
}
