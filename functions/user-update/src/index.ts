import { Request, Response } from 'express';


export const updateUser = async (req: Request, res: Response) => {
    res.status(200).json({ message: 'User updated successfully' });
};
