import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

const { signInWithPassword, resetPasswordForEmail, signUp } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('../supabase', () => ({
  default: {
    auth: {
      signInWithPassword,
      signUp,
      signOut: vi.fn(),
      updateUser: vi.fn(),
      resetPasswordForEmail,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    })),
  },
}))

describe('Login password recovery', () => {
  const clickSubmit = () => {
    fireEvent.click(screen.getAllByText('Sign In')[1])
  }

  beforeEach(() => {
    signInWithPassword.mockReset()
    resetPasswordForEmail.mockReset()
    signUp.mockReset()
    signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'admin@hospital.co.ke' } },
      error: null,
    })
    resetPasswordForEmail.mockResolvedValue({ data: null, error: null })
    window.notifyFromLegacyAlert.mockClear()
  })

  it('renders the login form with email and password fields', () => {
    render(<Login onLogin={vi.fn()} isPasswordRecovery={false} onResetDone={vi.fn()} />)

    expect(screen.getAllByPlaceholderText('admin@hospital.co.ke')[0]).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument()
    expect(screen.getAllByText('Sign In').length).toBeGreaterThan(0)
  })

  it('shows an error when submitting an empty form', () => {
    render(<Login onLogin={vi.fn()} isPasswordRecovery={false} onResetDone={vi.fn()} />)

    clickSubmit()

    expect(screen.getByText('Enter email and password')).toBeInTheDocument()
  })

  it('shows a loading state and calls Supabase with the entered credentials', async () => {
    let resolveLogin
    signInWithPassword.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLogin = resolve
    }))

    render(<Login onLogin={vi.fn()} isPasswordRecovery={false} onResetDone={vi.fn()} />)

    fireEvent.change(screen.getAllByPlaceholderText('admin@hospital.co.ke')[0], {
      target: { value: 'admin@hospital.co.ke' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'secret123' },
    })
    clickSubmit()

    expect(await screen.findByText('Signing in...')).toBeInTheDocument()
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@hospital.co.ke',
      password: 'secret123',
    })

    resolveLogin({
      data: { user: { id: 'user-1', email: 'admin@hospital.co.ke' } },
      error: null,
    })

    await waitFor(() => {
      expect(screen.queryByText('Signing in...')).not.toBeInTheDocument()
    })
  })

  it('displays an auth error when login fails', async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })

    render(<Login onLogin={vi.fn()} isPasswordRecovery={false} onResetDone={vi.fn()} />)

    fireEvent.change(screen.getAllByPlaceholderText('admin@hospital.co.ke')[0], {
      target: { value: 'admin@hospital.co.ke' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'wrongpass' },
    })
    clickSubmit()

    expect(await screen.findByText('The password you entered is incorrect for this email address.')).toBeInTheDocument()
  })

  it('sends reset emails through the remedacare deep link redirect', async () => {
    render(<Login onLogin={vi.fn()} isPasswordRecovery={false} onResetDone={vi.fn()} />)

    fireEvent.click(screen.getByText('Forgot Password?'))
    fireEvent.change(screen.getByPlaceholderText('admin@hospital.co.ke'), {
      target: { value: 'admin@hospital.co.ke' },
    })
    fireEvent.click(screen.getByText('Send Reset Link'))

    await waitFor(() => {
      expect(resetPasswordForEmail).toHaveBeenCalledWith('admin@hospital.co.ke', {
        redirectTo: 'remedacarehms://reset',
      })
    })
  })

  it('sends signup confirmation links through the activation deep link', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null })

    render(<Login onLogin={vi.fn()} isPasswordRecovery={false} onResetDone={vi.fn()} />)

    fireEvent.click(screen.getByText('Create one'))
    fireEvent.change(screen.getByPlaceholderText('My Hospital'), {
      target: { value: 'Brightpath General' },
    })
    fireEvent.change(screen.getByPlaceholderText('Kenya'), {
      target: { value: 'Nairobi' },
    })
    fireEvent.change(screen.getByPlaceholderText('Dr. John Doe'), {
      target: { value: 'Dr. Activate' },
    })
    fireEvent.change(screen.getByPlaceholderText('admin@hospital.co.ke'), {
      target: { value: 'admin@hospital.co.ke' },
    })
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'Secret123!' },
    })
    fireEvent.click(screen.getAllByText('Create Account')[1])

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith({
        email: 'admin@hospital.co.ke',
        password: 'Secret123!',
        options: expect.objectContaining({
          emailRedirectTo: 'remedacarehms://activate',
        }),
      })
    })
  })
})

