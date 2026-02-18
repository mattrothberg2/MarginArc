import { defaultTheme } from 'react-admin'
import { createTheme } from '@mui/material/styles'
import { deepmerge } from '@mui/utils'

const marginArcTheme = createTheme(
  deepmerge(defaultTheme, {
    palette: {
      primary: {
        main: '#02b1b5',
        dark: '#009196',
        light: '#4dd3d8',
        contrastText: '#ffffff',
      },
      secondary: {
        main: '#0a1a2f',
        contrastText: '#ffffff',
      },
      background: {
        default: '#f1f5f9',
        paper: '#ffffff',
      },
    },
    typography: {
      fontFamily:
        "'Inter var', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: '#0a1a2f',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: '#0f2440',
            color: '#e2e8f0',
          },
        },
      },
      RaMenuItemLink: {
        styleOverrides: {
          root: {
            color: '#cbd5e1',
            '&:hover': {
              backgroundColor: 'rgba(2, 177, 181, 0.1)',
              color: '#4dd3d8',
            },
            '&.RaMenuItemLink-active': {
              backgroundColor: 'rgba(2, 177, 181, 0.15)',
              borderLeft: '3px solid #02b1b5',
              color: '#02b1b5',
              fontWeight: 600,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          containedPrimary: {
            backgroundColor: '#02b1b5',
            '&:hover': { backgroundColor: '#009196' },
          },
        },
      },
    },
  })
)

export default marginArcTheme
