import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataTable, Field, Modal, PatientBanner, patientAge } from './index'

describe('UI kit', () => {
  it('Field wires label, hint and error to the input', () => {
    render(<Field label="Phone" hint="07…" error="Required" required><input /></Field>)
    const input = screen.getByLabelText(/Phone/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })
  it('Modal is a labelled dialog and closes on Escape', () => {
    const onClose = vi.fn()
    render(<Modal title="Add patient" onClose={onClose}><input aria-label="Name" /></Modal>)
    expect(screen.getByRole('dialog', { name: 'Add patient' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('DataTable renders rows and handles empty lists', () => {
    const { rerender } = render(<DataTable columns={[{ key: 'name', label: 'Name' }]} rows={[{ id: 1, name: 'Jane' }]} />)
    expect(screen.getByText('Jane')).toBeInTheDocument()
    rerender(<DataTable columns={[{ key: 'name', label: 'Name' }]} rows={[]} empty="No patients" />)
    expect(screen.getByText('No patients')).toBeInTheDocument()
  })
  it('PatientBanner always shows allergies, in words not only colour', () => {
    render(<PatientBanner patient={{ full_name: 'Jane', age: '34', gender: 'Female', allergies: 'Penicillin' }} alerts={['Pregnant']} />)
    expect(screen.getByText('Allergy: Penicillin')).toBeInTheDocument()
    expect(screen.getByText('Pregnant')).toBeInTheDocument()
    render(<PatientBanner patient={{ full_name: 'Bob', allergies: 'NKDA' }} />)
    expect(screen.getByText('No known allergies')).toBeInTheDocument()
  })
  it('age from date of birth for babies', () => {
    const dob = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10)
    expect(patientAge({ date_of_birth: dob })).toMatch(/^6 mo$/)
    expect(patientAge({ age: '45' })).toBe('45 y')
  })
})
