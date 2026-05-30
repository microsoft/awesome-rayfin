import type { Customer } from '../../../rayfin/data/Customer';

export interface ICustomerService {
  searchByPhone(phone: string): Promise<Customer[]>;
  getAllCustomers(): Promise<Customer[]>;
  createCustomer(data: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
  }): Promise<Customer>;
  getCustomer(id: string): Promise<Customer | null>;
}
